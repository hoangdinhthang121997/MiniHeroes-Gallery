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
  packageVersion,
  proxySettingsMatch,
  isGameRunning,
  readProxySettings,
  restartGame,
  restoreProxySettings,
  writeProxy,
} from './adb.mjs';
import { createRunCertificate, removeLegacyCertificateStore } from './cert.mjs';
import { API_HOST, PROBE_PATH, PROBE_REPLY, createProxy } from './proxy.mjs';
import {
  RECOVERY_PATH,
  deleteRecovery,
  readRecovery,
  recoverInterruptedRun,
  recoveryLines,
  writeRecovery,
} from './proxy-state.mjs';
import { buildRoster, readLoginBody, findAccount } from './roster.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_CERT_DIR = path.join(HERE, '.local');

const DEFAULT_TIMEOUT_SECONDS = 240;
const PRIVATE_FIELD_NAMES = ['token', 'openId', 'uid'];

function parseArgs(argv) {
  const options = {
    adb: null,
    device: null,
    out: path.resolve(HERE, '..', '..', 'roster.json'),
    catalogueVersion: null,
    timeout: DEFAULT_TIMEOUT_SECONDS,
    debug: false,
    restart: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} needs a value after it.`);
      return argv[i];
    };
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--adb':
        options.adb = next();
        break;
      case '--device':
        options.device = next();
        break;
      case '--out':
        options.out = path.resolve(next());
        break;
      case '--catalogue-version':
        options.catalogueVersion = next();
        break;
      case '--restart':
        options.restart = true;
        break;
      case '--debug':
        options.debug = true;
        break;
      case '--timeout':
        options.timeout = Number(next());
        if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
          throw new Error('--timeout needs a number of seconds.');
        }
        break;
      default:
        throw new Error(`I do not know the option ${arg}. Run with --help to see the list.`);
    }
  }
  return options;
}

const HELP = `Mini Heroes roster exporter

  node export.mjs [options]

Options
  --out PATH               where to save roster.json (default: OPTIONAL - IMPORT FROM GAME/roster.json)
  --device SERIAL          use this emulator, instead of finding one
  --adb PATH               use this adb program, instead of finding one
  --catalogue-version V    stamp this catalogue version into the roster
  --timeout SECONDS        how long to wait for the game to sign in (default ${DEFAULT_TIMEOUT_SECONDS})
  --restart                close and reopen the game for me if it is already open
  --debug                  print each game request as it happens
  --help                   show this

This reads one game server, ${API_HOST}, over a connection that
only this computer can reach. Neither of those is an option, on purpose.

To put an emulator's network setting back at any time, and do nothing else:

  node restore.mjs
`;
let putBackRef = null;

function step(number, total, message) {
  process.stdout.write(`  ${number} of ${total}  ${message}\n`);
}

function detail(message) {
  process.stdout.write(`          ${message}\n`);
}
function sayWhatThisDoes() {
  process.stdout.write(
    '  Before it starts, here is what this does.\n' +
      '\n' +
      '    It changes one setting on your Mini Heroes emulator, for the few minutes\n' +
      '    it takes you to sign in: the network proxy setting, which routes the\n' +
      '    emulator through this computer so the reply carrying your hero list can\n' +
      '    be read.\n' +
      '\n' +
      `    It reads replies from one server, ${API_HOST}, and\n` +
      '    no other.\n' +
      '    It does not install a certificate on your emulator.\n' +
      '    It does not touch your Google account.\n' +
      '    It saves no sign-in information of any kind.\n' +
      '    It puts your original setting back automatically, as soon as your heroes\n' +
      '    have been read, and checks that it went back.\n' +
      '\n'
  );
}
function shapeOf(node, depth = 0) {
  if (Array.isArray(node)) return `array(${node.length})`;
  if (node === null || typeof node !== 'object') return typeof node;
  const keys = Object.keys(node);
  if (depth >= 2) return `object(${keys.length} keys)`;
  return `{ ${keys.map((key) => `${key}: ${shapeOf(node[key], depth + 1)}`).join(', ')} }`;
}
function findPemFiles(directory) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...findPemFiles(full));
    else if (/\.pem$/i.test(entry.name)) found.push(full);
  }
  return found;
}
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
      `printf 'GET ${PROBE_PATH} HTTP/1.0\\r\\nHost: probe\\r\\n\\r\\n' | ` +
      `nc -w 3 ${candidate.address} ${port}`;
    const output = await adb.shellAsync(command, { allowFail: true, timeout: 12000 });
    if (probeState.hits > 0 || output.includes(PROBE_REPLY)) {
      return candidate;
    }
    if (candidate.teardown) candidate.teardown();
  }
  return null;
}
function resolveCatalogueVersion(adb, options) {
  if (options.catalogueVersion) {
    return { version: options.catalogueVersion, from: 'the --catalogue-version option' };
  }
  const searchDirs = [path.resolve(HERE, '..'), path.resolve(HERE, '..', 'dist')];
  for (const dir of searchDirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const found = entries.filter((name) => /^catalogue\..+\.json$/.test(name));
    if (found.length !== 1) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, found[0]), 'utf8'));
      if (typeof parsed.catalogueVersion === 'string') {
        return { version: parsed.catalogueVersion, from: path.join(dir, found[0]) };
      }
    } catch {
    }
  }
  const installed = packageVersion(adb);
  if (installed) return { version: installed, from: `the installed game (version ${installed})` };
  return { version: null, from: 'nowhere: the version could not be read' };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const TOTAL = 6;
  process.stdout.write('\nMini Heroes roster exporter\n\n');
  sayWhatThisDoes();
  step(1, TOTAL, 'Looking for your emulator...');
  const noteAtStartup = readRecovery();
  if (noteAtStartup && noteAtStartup.unreadable) {
    for (const line of recoveryLines({ state: 'unreadable', reason: noteAtStartup.unreadable })) {
      detail(line);
    }
    throw new Error('Stopping here so that the unreadable recovery note is not lost.');
  }
  const adbPath = discoverAdb(options.adb);
  const interrupted = recoverInterruptedRun(adbPath);
  for (const line of recoveryLines(interrupted)) detail(line);
  if (
    interrupted.state === 'device-missing' ||
    interrupted.state === 'failed' ||
    interrupted.state === 'unreadable'
  ) {
    throw new Error('Stopping here so that record is not lost.');
  }

  const adb = new Adb(adbPath, null);
  adb.serial = discoverDevice(adb, options.device);
  detail(`Found it: ${adb.serial}`);
  if (!isPackageInstalled(adb)) {
    throw new Error(
      'Mini Heroes does not seem to be installed on that emulator. Install it, sign in once, ' +
        'then run this again.'
    );
  }

  const catalogue = resolveCatalogueVersion(adb, options);
  const original = readProxySettings(adb);

  let cleaned = false;
  let restoreOutcome = null;
  let reverseTeardown = null;
  let stopProxyAsync = null;
  let stopProxySync = null;
  let proxyWritten = false;
  let noteWritten = false;
  const putBack = () => {
    if (cleaned) return restoreOutcome;
    cleaned = true;
    if (stopProxySync) stopProxySync();
    if (reverseTeardown) {
      try {
        reverseTeardown();
      } catch {
      }
    }
    if (!proxyWritten) {
      if (noteWritten) deleteRecovery();
      restoreOutcome = { ok: true, problems: [], differences: [] };
      return restoreOutcome;
    }
    const problems = restoreProxySettings(adb, original);
    const check = proxySettingsMatch(adb, original);
    const ok = problems.length === 0 && check.ok;
    if (ok) deleteRecovery();
    restoreOutcome = { ok, problems, differences: check.differences };
    return restoreOutcome;
  };

  const sayPutBack = (outcome) => {
    if (!outcome.ok) {
      process.stdout.write('\n  I could not fully undo the connection setting.\n');
      for (const problem of outcome.problems) process.stdout.write(`    ${problem}\n`);
      for (const difference of outcome.differences) process.stdout.write(`    ${difference}\n`);
      process.stdout.write(`    Your original values are written down in ${RECOVERY_PATH}\n`);
      process.stdout.write(
        '    Run "2 - RESTORE EMULATOR NETWORK.cmd" in the OPTIONAL - IMPORT FROM GAME folder to try again.\n'
      );
      return;
    }
    detail('Done. The connection setting is exactly as it was.');
    detail('If the game complains about the connection, close and reopen it.');
  };
  const putBackAndSay = () => {
    if (cleaned) return;
    if (!proxyWritten) {
      putBack();
      return;
    }
    process.stdout.write('\n  Putting your emulator back the way it was...\n');
    sayPutBack(putBack());
  };

  putBackRef = putBackAndSay;
  process.on('exit', () => {
    if (cleaned) return;
    const outcome = putBack();
    if (!outcome.ok) sayPutBack(outcome);
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    try {
      process.on(signal, () => {
        process.stdout.write('\n  Stopping early.\n');
        putBackAndSay();
        process.exit(130);
      });
    } catch {
    }
  }
  process.on('uncaughtException', (error) => {
    process.stdout.write(`\n  Something went wrong: ${error.message}\n`);
    putBackAndSay();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    process.stdout.write(`\n  Something went wrong: ${reason}\n`);
    putBackAndSay();
    process.exit(1);
  });
  step(2, TOTAL, 'Setting up a private connection...');
  const legacy = removeLegacyCertificateStore(LEGACY_CERT_DIR);
  if (legacy) detail(`Deleted a certificate an older version of this tool left in ${legacy.directory}`);
  const credentials = createRunCertificate();
  detail('Made a certificate for this run only. It is not written to disk.');

  let captured = null;
  let inspected = 0;
  const probeState = { hits: 0 };
  const proxy = createProxy({
    credentials,
    onProbe: () => {
      probeState.hits += 1;
    },
    onCapture: ({ path, body }) => {
      if (captured || body.length === 0) return;
      inspected += 1;
      let parsed = null;
      let account = null;
      try {
        parsed = readLoginBody(body);
        account = findAccount(parsed);
      } catch (error) {
        if (options.debug) detail(`could not read ${path}: ${error.message}`);
        return;
      }
      if (!account) {
        if (options.debug) {
          detail(`${path}: readable, but no hero list in it`);
          detail(`  top level: ${shapeOf(parsed)}`);
        }
        return;
      }
      captured = account;
      detail(`Found your heroes in the reply to ${path}`);
    },
    onLog: (message) => {
      if (options.debug) detail(message);
    },
  });
  const { server } = proxy;
  stopProxyAsync = proxy.stop;
  stopProxySync = proxy.stopSync;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const bound = server.address();
  const port = bound.port;
  const loopbackOnly = bound.address === '127.0.0.1';
  detail(`Listening on ${bound.address}:${port}, and on nothing else`);

  const reachable = await findReachableAddress(adb, port, probeState);
  if (!reachable) {
    await stopProxyAsync();
    throw new Error(
      'I could not get a private connection that your emulator can reach, so I have ' +
        'stopped without changing anything on it. Close the emulator completely, start it ' +
        'again, wait for its home screen, then run this once more.'
    );
  }
  reverseTeardown = reachable.teardown;
  detail(`The emulator reaches this computer at ${reachable.address}`);
  writeRecovery(adb.serial, original);
  noteWritten = true;
  const savedNote = readRecovery();
  const backupWritten =
    savedNote !== null && !savedNote.unreadable && savedNote.serial === adb.serial;
  detail('Wrote down your current setting so it can be put back even after a crash.');
  proxyWritten = true;
  writeProxy(adb, `${reachable.address}:${port}`);
  detail('Ready.');
  const alreadyRunning = isGameRunning(adb);
  if (alreadyRunning && options.restart) {
    step(3, TOTAL, 'Closing Mini Heroes so it signs in again...');
    restartGame(adb);
    detail('Reopened. Tap Start on the title screen when it appears.');
  } else if (alreadyRunning) {
    step(3, TOTAL, 'Mini Heroes is open, and needs to be closed and reopened.');
    detail('It signed in before this tool started, so it will not sign in again');
    detail('on its own. Close the game fully, open it, and tap Start.');
    detail('Next time you can add --restart and this tool will do it for you.');
  } else {
    step(3, TOTAL, 'Now open Mini Heroes and tap Start.');
    detail('Your heroes are sent when the game signs in. Nothing else to do.');
  }

  step(4, TOTAL, 'Waiting for the game to sign in...');
  const deadline = Date.now() + options.timeout * 1000;
  let announced = 0;
  while (!captured && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const waited = Math.floor((options.timeout * 1000 - (deadline - Date.now())) / 1000);
    if (waited >= announced + 20) {
      announced = waited;
      detail(`Still waiting, ${waited} seconds so far. This can take a minute.`);
    }
  }

  await stopProxyAsync();
  step(5, TOTAL, 'Putting your emulator back the way it was...');
  const restored = putBack();
  sayPutBack(restored);

  if (!captured) {
    throw new Error(
      `The game did not open your account within ${options.timeout} seconds (${inspected} game ` +
        'replies were checked). The usual reason is that the Start button on the title screen ' +
        'was not tapped. Run this again, and tap Start when the title screen appears. You can ' +
        'allow more time with --timeout, or add --debug to see what the game asked for.'
    );
  }
  const { roster, notes } = buildRoster(captured, { catalogueVersion: catalogue.version });
  captured = null; // the login reply, and everything private in it, ends here.
  const rosterText = `${JSON.stringify(roster, null, 2)}\n`;
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, rosterText, 'utf8');

  step(6, TOTAL, `Saved ${roster.heroes.length} heroes.`);
  detail(options.out);
  detail(`Account level ${roster.account.teamLevel === null ? 'unknown' : roster.account.teamLevel}`);
  detail(`Catalogue version ${roster.catalogueVersion} taken from ${catalogue.from}`);
  for (const note of notes) detail(`Note: ${note}`);
  const mark = (done) => (done ? '[x]' : '[ ]');
  const credentialsNameNoFile = Object.values(credentials).every(
    (value) => typeof value === 'string' && !fs.existsSync(value)
  );
  const pemFilesLeft = findPemFiles(HERE);
  const certKeptInMemory =
    credentialsNameNoFile &&
    String(credentials.cert).startsWith('-----BEGIN CERTIFICATE-----') &&
    pemFilesLeft.length === 0;
  const leakedFields = PRIVATE_FIELD_NAMES.filter((name) =>
    rosterText.toLowerCase().includes(`"${name.toLowerCase()}"`)
  );
  process.stdout.write('\n  What this run did\n');
  process.stdout.write(
    `    ${mark(backupWritten)} Wrote your original network setting down before changing it\n`
  );
  process.stdout.write(
    `    ${mark(loopbackOnly)} Listened on this computer only, at ${bound.address} port ${port}\n`
  );
  process.stdout.write(
    `    ${mark(roster.heroes.length > 0)} Captured ${roster.heroes.length} heroes from the game's own reply\n`
  );
  process.stdout.write(
    `    ${mark(restored.ok)} Put your emulator network back, and read it again to check\n`
  );
  process.stdout.write(
    `    ${mark(certKeptInMemory)} Used a temporary certificate that was never saved to disk\n`
  );
  if (pemFilesLeft.length > 0) {
    for (const left of pemFilesLeft) process.stdout.write(`        Found a certificate file: ${left}\n`);
  }
  process.stdout.write(
    `    ${mark(leakedFields.length === 0)} Saved no sign-in information. Read back the saved file and looked for token, openId and uid\n`
  );
  if (leakedFields.length > 0) {
    process.stdout.write(
      `        Found ${leakedFields.join(', ')} in it. Delete ${options.out} and say so, because this should not happen.\n`
    );
  }
  if (!restored.ok) {
    process.stdout.write('\n  Partly done, and one thing still needs you.\n');
    process.stdout.write('\n  Your hero list was saved. That part worked.\n');
    process.stdout.write(
      '\n  Your emulator network setting could not be put back the way it was. Until\n' +
        '  it is, your emulator is pointing at a connection on this computer that has\n' +
        '  now closed, and your game may not be able to reach the internet.\n'
    );
    process.stdout.write(
      '\n  Please run "2 - RESTORE EMULATOR NETWORK.cmd" in the OPTIONAL - IMPORT FROM GAME folder. It\n' +
        '  puts the setting back and does nothing else.\n\n'
    );
    return 1;
  }
  if (!process.env.HERO_GALLERY_RUNNER) {
    process.stdout.write('\n  All done. You can close this window.\n\n');
  } else {
    process.stdout.write('\n  Hero list saved. Two more steps, please leave this open.\n\n');
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stdout.write(`\n  ${error.message}\n`);
    if (putBackRef) putBackRef();
    process.stdout.write('\n');
    process.exit(1);
  });
