
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
export const API_HOST = 'us-su-bldld.maxngame.com';

const PROBE_PATH = '/__exporter_probe';
const PROBE_REPLY = 'exporter-probe-ok';

function splitHostPort(authority, fallbackPort) {
  const lastColon = authority.lastIndexOf(':');
  if (lastColon === -1) return { host: authority, port: fallbackPort };
  const port = Number(authority.slice(lastColon + 1));
  if (!Number.isInteger(port)) return { host: authority, port: fallbackPort };
  return { host: authority.slice(0, lastColon), port };
}

function decodeBody(headers, buffer) {
  const encoding = String(headers['content-encoding'] || '').toLowerCase();
  try {
    if (encoding === 'gzip') return zlib.gunzipSync(buffer);
    if (encoding === 'deflate') return zlib.inflateSync(buffer);
    if (encoding === 'br') return zlib.brotliDecompressSync(buffer);
  } catch {
  }
  return buffer;
}
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export function createProxy({ credentials, onCapture, onProbe, onLog }) {
  const log = onLog || (() => {});
  const acceptedSockets = new Set();
  const clientSockets = new Set();
  const upstreamSockets = new Set();
  const activeRequests = new Set();
  const server = http.createServer();
  let stopping = false;
  let closeRequested = false;
  let stopPromise = null;

  const trackSocket = (socket, collection) => {
    if (!socket || typeof socket.on !== 'function') return socket;
    collection.add(socket);
    socket.once('close', () => collection.delete(socket));
    socket.on('error', () => {});
    return socket;
  };

  const trackRequest = (request) => {
    activeRequests.add(request);
    const forget = () => activeRequests.delete(request);
    request.once('close', forget);
    request.once('error', forget);
    request.on('socket', (socket) => trackSocket(socket, upstreamSockets));
    return request;
  };

  const destroyActive = () => {
    for (const request of activeRequests) request.destroy();
    const sockets = new Set([...acceptedSockets, ...clientSockets, ...upstreamSockets]);
    for (const socket of sockets) socket.destroy();
  };
  const stopSync = () => {
    stopping = true;
    if (!closeRequested) {
      closeRequested = true;
      try {
        server.close();
      } catch {
      }
    }
    destroyActive();
  };

  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      if (server.listening) server.once('close', finish);
      stopSync();
      if (!server.listening) finish();
    });
    return stopPromise;
  };
  const intercept = https.createServer(
    { key: credentials.key, cert: credentials.cert },
    (req, res) => {
      const path = req.url || '/';
      const headers = { ...req.headers };
      delete headers['proxy-connection'];

      const upstream = trackRequest(https.request(
        {
          host: API_HOST,
          servername: API_HOST,
          port: 443,
          method: req.method,
          path,
          headers,
        },
        (up) => {
          const outHeaders = { ...up.headers };
          delete outHeaders['transfer-encoding'];
          res.writeHead(up.statusCode || 502, outHeaders);

          const chunks = [];
          let size = 0;
          let tooBig = false;
          up.on('data', (chunk) => {
            res.write(chunk);
            if (tooBig) return;
            size += chunk.length;
            if (size > MAX_CAPTURE_BYTES) {
              tooBig = true;
              chunks.length = 0;
              return;
            }
            chunks.push(chunk);
          });
          up.on('end', () => {
            res.end();
            log(`${req.method} ${path} -> ${up.statusCode} (${size} bytes)`);
            if (tooBig) return;
            try {
              onCapture({
                method: req.method,
                path,
                status: up.statusCode,
                body: decodeBody(up.headers, Buffer.concat(chunks)),
              });
            } catch (error) {
              log(`could not read ${path}: ${error.message}`);
            }
          });
          up.on('error', () => res.destroy());
        }
      ));

      upstream.on('error', (error) => {
        log(`could not reach ${API_HOST}: ${error.message}`);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });

      req.pipe(upstream);
      req.on('error', () => upstream.destroy());
      res.on('error', () => {});
    }
  );
  intercept.on('tlsClientError', () => {});
  intercept.on('clientError', (error, socket) => socket.destroy());
  server.on('connection', (socket) => {
    trackSocket(socket, acceptedSockets);
    trackSocket(socket, clientSockets);
  });
  server.on('request', (req, res) => {
    if (stopping) {
      req.destroy();
      return;
    }
    const url = req.url || '';
    if (url.split('?')[0] === PROBE_PATH) {
      if (onProbe) onProbe();
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`${PROBE_REPLY}\n`);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      log(`refused ${req.method} ${url}`);
      req.resume();
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, HEAD' });
      res.end('Plain HTTP is refused except /generate_204.\n');
      return;
    }

    let target;
    try {
      target = new URL(url);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('This is a proxy. Absolute URLs only.\n');
      return;
    }

    if (target.protocol !== 'http:' || target.pathname !== '/generate_204') {
      log(`refused ${req.method} ${url}`);
      req.resume();
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Plain HTTP is refused except /generate_204.\n');
      return;
    }

    res.writeHead(204, { 'content-length': '0' });
    res.end();
    return;

  });

  server.on('connect', (req, clientSocket, head) => {
    if (stopping) {
      clientSocket.destroy();
      return;
    }
    trackSocket(clientSocket, clientSockets);
    clientSocket.on('error', () => {});
    const parsed = splitHostPort(req.url || '', 443);
    const host = String(parsed.host || '').trim().replace(/\.$/, '').toLowerCase();
    const port = parsed.port;
    const isApprovedTarget = host === API_HOST && port === 443;
    log(`connect ${host}:${port}${isApprovedTarget ? ' (reading this one)' : ' (refused)'}`);

    if (isApprovedTarget) {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length > 0) clientSocket.unshift(head);
      intercept.emit('connection', clientSocket);
      return;
    }
    // Security boundary: this exporter is not a general-purpose CONNECT proxy.
    // Anything other than the one validated game API endpoint fails closed.
    clientSocket.end(
      'HTTP/1.1 403 Forbidden\r\n' +
        'Connection: close\r\n' +
        'Content-Length: 0\r\n' +
        '\r\n'
    );
  });

  server.on('clientError', (error, socket) => socket.destroy());

  return { server, stop, stopSync, PROBE_PATH, PROBE_REPLY };
}

export { PROBE_PATH, PROBE_REPLY };
