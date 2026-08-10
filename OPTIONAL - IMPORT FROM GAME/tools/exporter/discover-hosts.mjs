#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Adb,
  defaultGateway,
  deviceSubnetHostGuess,
  discoverAdb,
  discoverDevice,
  isPackageInstalled,
  proxySettingsMatch,
  readProxySettings,
  restartGame,
  restoreProxySettings,
  writeProxy,
} from './adb.mjs';
import {
  RECOVERY_PATH,
  deleteRecovery,
  readRecovery,
  recoverInterruptedRun,
  recoveryLines,
  writeRecovery,
} from './proxy-state.mjs';
import {
  DISCOVERY_PROBE_PATH,
  DISCOVERY_PROBE_REPLY,
  createDiscoveryProxy,
} from './discovery-proxy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SECONDS = 120;
const DEFAULT_OUT = path.resolve(HERE, '..', '..', 'discovered-hosts.txt');

/* -------------------------------------------------------------------------- */
/* Command-line options                                                        */
/* -------------------------------------------------------------------------- */
function parseArgs(argv) {
  const options = { adb: null, device: null, out: DEFAULT_OUT, seconds: DEFAULT_SECONDS, restart: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} needs a value after it.`);
      return argv[i];
    };
    if (arg === '--adb') options.adb = next();
    else if (arg === '--device') options.device = next();
    else if (arg === '--out') options.out = path.resolve(next());
    else if (arg === '--seconds') options.seconds = Number(next());
    else if (arg === '--restart') options.restart = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isFinite(options.seconds) || options.seconds < 15 || options.seconds > 900) {
    throw new Error('--seconds must be between 15 and 900.');
  }
  return options;
}

const HELP = `Mini Heroes regional-host discovery\n\n` +
  `  node discover-hosts.mjs [options]\n\n` +
  `Options\n` +
  `  --seconds N       observe for N seconds (default ${DEFAULT_SECONDS}, max 900)\n` +
  `  --out PATH        output file (default OPTIONAL - IMPORT FROM GAME/discovered-hosts.txt)\n` +
  `  --restart         restart Mini Heroes automatically\n` +
  `  --device SERIAL   select a specific emulator\n` +
  `  --adb PATH        select a specific adb executable\n` +
  `  --help            show this text\n\n` +
  `The tool records hostnames only. It does not decrypt HTTPS or save account data.\n`;

function detail(message) {
  process.stdout.write(`  ${message}\n`);
}

/* -------------------------------------------------------------------------- */
/* Find a loopback-only proxy address the emulator can reach                   */
/* -------------------------------------------------------------------------- */
async function findReachableAddress(adb, port, probeState) {
  const candidates = [
    {
      address: '127.0.0.1',
      setup: () => adb.deviceAsync(['reverse', `tcp:${port}`, `tcp:${port}`], { allowFail: true }),
      teardown: () => adb.device(['reverse', '--remove', `tcp:${port}`], { allowFail: true }),
    },
  ];
  const gateway = defaultGateway(adb);
  if (gateway) candidates.push({ address: gateway, setup: null, teardown: null });
  const guess = deviceSubnetHostGuess(adb);
  if (guess && guess !== gateway) candidates.push({ address: guess, setup: null, teardown: null });

  for (const candidate of candidates) {
    if (candidate.setup) await candidate.setup();
    probeState.hits = 0;
    const command =
      `printf 'GET ${DISCOVERY_PROBE_PATH} HTTP/1.0\\r\\nHost: probe\\r\\n\\r\\n' | ` +
      `nc -w 3 ${candidate.address} ${port}`;
    const output = await adb.shellAsync(command, { allowFail: true, timeout: 12000 });
    if (probeState.hits > 0 || output.includes(DISCOVERY_PROBE_REPLY)) return candidate;
    if (candidate.teardown) candidate.teardown();
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Main discovery run + crash-safe emulator network restoration                */
/* -------------------------------------------------------------------------- */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  process.stdout.write('\nMini Heroes regional-host discovery\n\n');
  detail('This records only MAX GAME hostnames requested by the emulator.');
  detail('HTTPS stays end-to-end encrypted; no certificate is installed.');
  detail('Only maxngame.com hosts on port 443 that resolve to public IPv4 addresses are forwarded.');

  const noteAtStartup = readRecovery();
  if (noteAtStartup && noteAtStartup.unreadable) {
    throw new Error(`The recovery note at ${RECOVERY_PATH} is unreadable. Run the restore tool first.`);
  }

  const adbPath = discoverAdb(options.adb);
  const interrupted = recoverInterruptedRun(adbPath);
  for (const line of recoveryLines(interrupted)) detail(line);
  if (['device-missing', 'failed', 'unreadable'].includes(interrupted.state)) {
    throw new Error('Stopping so the previous emulator network state is not lost.');
  }

  const adb = new Adb(adbPath, null);
  adb.serial = discoverDevice(adb, options.device);
  detail(`Emulator: ${adb.serial}`);
  if (!isPackageInstalled(adb)) throw new Error('Mini Heroes is not installed on this emulator.');

  const original = readProxySettings(adb);
  const found = new Set();
  const probeState = { hits: 0 };
  let reverseTeardown = null;
  let proxyWritten = false;
  let noteWritten = false;
  let cleaned = false;
  let stopProxySync = null;
  let stopProxyAsync = null;

  const saveHosts = () => {
    const hosts = [...found].sort();
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    const header = [
      '# Mini Heroes publisher hosts observed during regional discovery',
      '# Hostnames only; no requests, headers, tokens, or response data are stored.',
      `# Observed: ${new Date().toISOString()}`,
      '',
    ];
    fs.writeFileSync(options.out, `${header.join('\n')}${hosts.join('\n')}${hosts.length ? '\n' : ''}`, 'utf8');
  };

  const restore = () => {
    if (cleaned) return;
    cleaned = true;
    if (stopProxySync) stopProxySync();
    if (reverseTeardown) {
      try { reverseTeardown(); } catch {}
    }
    if (proxyWritten) {
      const problems = restoreProxySettings(adb, original);
      const check = proxySettingsMatch(adb, original);
      if (problems.length === 0 && check.ok) deleteRecovery();
      else {
        process.stderr.write(`\nWARNING: automatic proxy restoration was incomplete.\n`);
        process.stderr.write(`Run "2 - RESTORE EMULATOR NETWORK.cmd". Recovery data remains at ${RECOVERY_PATH}\n`);
      }
    } else if (noteWritten) {
      deleteRecovery();
    }
    try { saveHosts(); } catch {}
  };

  process.on('exit', restore);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    try {
      process.on(signal, () => {
        process.stdout.write('\nStopping discovery and restoring the emulator...\n');
        restore();
        process.exit(130);
      });
    } catch {}
  }

  const proxy = createDiscoveryProxy({
    onProbe: () => { probeState.hits += 1; },
    onHost: (host) => {
      found.add(host);
      detail(`Observed publisher host: ${host}`);
      saveHosts();
    },
    onLog: () => {},
  });
  stopProxySync = proxy.stopSync;
  stopProxyAsync = proxy.stop;

  await new Promise((resolve, reject) => {
    proxy.server.once('error', reject);
    proxy.server.listen(0, '127.0.0.1', resolve);
  });
  const bound = proxy.server.address();
  detail(`Discovery listener: ${bound.address}:${bound.port}`);

  const reachable = await findReachableAddress(adb, bound.port, probeState);
  if (!reachable) {
    await stopProxyAsync();
    throw new Error('The emulator could not reach the private discovery listener. No proxy setting was changed.');
  }
  reverseTeardown = reachable.teardown;

  writeRecovery(adb.serial, original);
  noteWritten = true;
  proxyWritten = true;
  writeProxy(adb, `${reachable.address}:${bound.port}`);

  if (options.restart) {
    detail('Restarting Mini Heroes. Tap Start when the title screen appears.');
    restartGame(adb);
  } else {
    detail('Close and reopen Mini Heroes, then tap Start. Navigate through the screens you want to test.');
  }
  detail(`Observing for ${options.seconds} seconds...`);

  await new Promise((resolve) => setTimeout(resolve, options.seconds * 1000));
  await stopProxyAsync();
  stopProxySync = null;
  restore();
  saveHosts();

  process.stdout.write('\nDiscovery complete.\n');
  detail(`Saved ${found.size} publisher hostname(s) to:`);
  detail(options.out);
  if (found.size) {
    process.stdout.write('\n');
    for (const host of [...found].sort()) process.stdout.write(`  ${host}\n`);
  }
  process.stdout.write('\nNext: open \"SERVER FIX.html\" in the OPTIONAL - IMPORT FROM GAME folder and load this file plus tools\\exporter\\proxy.mjs.\n');
}

main().catch((error) => {
  process.stderr.write(`\nERROR: ${error.message}\n`);
  process.exitCode = 1;
});
