import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';

/* -------------------------------------------------------------------------- */
/* Discovery proxy security policy                                             */
/* -------------------------------------------------------------------------- */
// This proxy exists only to identify which MAX GAME hostnames the emulator
// requests. It never decrypts HTTPS. To avoid recreating the general CONNECT
// tunnel fixed in proxy.mjs, it forwards only:
//   1) TCP port 443,
//   2) maxngame.com or a subdomain of maxngame.com, and
//   3) a destination that resolves to a public IPv4 address.
// The socket is connected to the already-validated IP, preventing a second DNS
// lookup from redirecting the connection to a private/loopback address.

export const DISCOVERY_PROBE_PATH = '/__host_discovery_probe';
export const DISCOVERY_PROBE_REPLY = 'host-discovery-probe-ok';
export const PUBLISHER_DOMAIN = 'maxngame.com';

export function normalizeHost(host) {
  return String(host || '').trim().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
}

export function splitHostPort(authority, fallbackPort = 443) {
  const value = String(authority || '').trim();
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close === -1) return { host: value, port: fallbackPort };
    const host = value.slice(1, close);
    if (value[close + 1] !== ':') return { host, port: fallbackPort };
    const port = Number(value.slice(close + 2));
    return { host, port: Number.isInteger(port) ? port : fallbackPort };
  }
  const lastColon = value.lastIndexOf(':');
  if (lastColon === -1) return { host: value, port: fallbackPort };
  const port = Number(value.slice(lastColon + 1));
  if (!Number.isInteger(port)) return { host: value, port: fallbackPort };
  return { host: value.slice(0, lastColon), port };
}

export function isPublisherHost(host) {
  const value = normalizeHost(host);
  return value === PUBLISHER_DOMAIN || value.endsWith(`.${PUBLISHER_DOMAIN}`);
}

function ipv4ToInt(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inCidr(value, base, prefix) {
  const address = ipv4ToInt(value);
  const network = ipv4ToInt(base);
  if (address === null || network === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (network & mask);
}

export function isPublicIPv4(address) {
  if (net.isIP(address) !== 4) return false;

  // Non-routable, private, documentation, benchmarking, multicast, reserved,
  // and link-local ranges are deliberately blocked for SSRF/pivot resistance.
  const blocked = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  return !blocked.some(([base, prefix]) => inCidr(address, base, prefix));
}

async function resolvePublicIPv4(host, lookup = dns.lookup) {
  if (net.isIP(host)) {
    return isPublicIPv4(host) ? host : null;
  }
  const answers = await lookup(host, { all: true, family: 4, verbatim: true });
  const publicAnswer = answers.find((answer) => isPublicIPv4(answer.address));
  return publicAnswer ? publicAnswer.address : null;
}

/* -------------------------------------------------------------------------- */
/* Proxy implementation                                                        */
/* -------------------------------------------------------------------------- */
export function createDiscoveryProxy({ onHost, onProbe, onLog, lookup } = {}) {
  const log = onLog || (() => {});
  const seen = new Set();
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const path = (req.url || '').split('?')[0];
    if (path === DISCOVERY_PROBE_PATH) {
      if (onProbe) onProbe();
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`${DISCOVERY_PROBE_REPLY}\n`);
      return;
    }

    // Android connectivity checks are harmless and do not need forwarding.
    let target = null;
    try {
      target = new URL(req.url || '');
    } catch {
    }
    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      target &&
      target.protocol === 'http:' &&
      target.pathname === '/generate_204'
    ) {
      res.writeHead(204, { 'content-length': '0' });
      res.end();
      return;
    }

    req.resume();
    res.writeHead(403, { 'content-type': 'text/plain', connection: 'close' });
    res.end('Discovery mode forwards HTTPS publisher hosts only.\n');
  });

  const track = (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    return socket;
  };

  server.on('connection', track);
  server.on('connect', async (req, clientSocket, head) => {
    track(clientSocket);
    const parsed = splitHostPort(req.url || '', 443);
    const host = normalizeHost(parsed.host);
    const port = parsed.port;

    if (port !== 443 || !isPublisherHost(host)) {
      log(`blocked CONNECT ${host}:${port}`);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }

    if (!seen.has(host)) {
      seen.add(host);
      if (onHost) onHost(host);
    }

    let address;
    try {
      address = await resolvePublicIPv4(host, lookup || dns.lookup);
    } catch (error) {
      log(`could not resolve ${host}: ${error.message}`);
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (!address) {
      log(`blocked ${host}: it did not resolve to a public IPv4 address`);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }

    const upstream = track(net.connect({ host: address, port: 443 }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    }));
    upstream.on('error', () => clientSocket.destroy());
  });

  server.on('clientError', (error, socket) => socket.destroy());

  const stopSync = () => {
    try {
      server.close();
    } catch {
    }
    for (const socket of sockets) socket.destroy();
  };

  const stop = () => new Promise((resolve) => {
    if (!server.listening) {
      stopSync();
      resolve();
      return;
    }
    server.once('close', resolve);
    stopSync();
  });

  return { server, stop, stopSync, seen };
}
