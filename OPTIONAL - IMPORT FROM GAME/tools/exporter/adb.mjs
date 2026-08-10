
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OFFICIAL_ADB =
  'C:/Program Files/Google/Play Games Developer Emulator/current/emulator/adb.exe';
const CONNECT_FALLBACK = 'localhost:6520';

export const GAME_PACKAGE = 'com.and.brawl.en';
const PROXY_KEYS = [
  'http_proxy',
  'global_http_proxy_host',
  'global_http_proxy_port',
  'global_http_proxy_exclusion_list',
];

function findOnPath(executable) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, executable);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
    }
  }
  return null;
}

export function discoverAdb(override) {
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`No adb program at the path given with --adb: ${override}`);
    }
    return override;
  }
  if (fs.existsSync(OFFICIAL_ADB)) return OFFICIAL_ADB;
  const onPath = findOnPath(process.platform === 'win32' ? 'adb.exe' : 'adb');
  if (onPath) return onPath;
  throw new Error(
    'Could not find adb. Install or repair the Google Play Games Developer Emulator, ' +
      'or pass --adb with the full path to adb.exe.'
  );
}

export class Adb {
  constructor(adbPath, serial) {
    this.adbPath = adbPath;
    this.serial = serial;
  }
  run(args, { timeout = 15000, allowFail = false } = {}) {
    try {
      return execFileSync(this.adbPath, args, {
        timeout,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      if (allowFail) return '';
      const detail = (error.stderr || error.message || '').toString().trim();
      throw new Error(`adb ${args.join(' ')} failed: ${detail}`);
    }
  }

  device(args, options) {
    if (!this.serial) throw new Error('No device selected yet.');
    return this.run(['-s', this.serial, ...args], options);
  }
  shell(command, options) {
    return this.device(['shell', command], options);
  }
  runAsync(args, { timeout = 15000, allowFail = false } = {}) {
    return new Promise((resolve, reject) => {
      execFile(
        this.adbPath,
        args,
        { timeout, encoding: 'utf8', windowsHide: true },
        (error, stdout, stderr) => {
          if (error && !allowFail) {
            const detail = (stderr || error.message || '').toString().trim();
            reject(new Error(`adb ${args.join(' ')} failed: ${detail}`));
            return;
          }
          resolve(stdout || '');
        }
      );
    });
  }

  deviceAsync(args, options) {
    if (!this.serial) throw new Error('No device selected yet.');
    return this.runAsync(['-s', this.serial, ...args], options);
  }

  shellAsync(command, options) {
    return this.deviceAsync(['shell', command], options);
  }
}

export function listDevices(adb) {
  const output = adb.run(['devices', '-l']);
  const lines = output.split(/\r?\n/);
  if ((lines[0] || '').trim() !== 'List of devices attached') {
    throw new Error('adb did not return a device list in the expected form.');
  }
  return lines
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(/\s+/);
      return { serial: fields[0], state: (fields[1] || '').toLowerCase() };
    });
}
export function discoverDevice(adb, override) {
  let devices = listDevices(adb);

  if (override) {
    const match = devices.find((d) => d.serial === override);
    if (!match) {
      adb.run(['connect', override], { allowFail: true });
      devices = listDevices(adb);
    }
    const found = devices.find((d) => d.serial === override);
    if (!found) throw new Error(`The device given with --device is not attached: ${override}`);
    if (found.state !== 'device') {
      throw new Error(`The device ${override} is attached but its state is "${found.state}".`);
    }
    return found.serial;
  }

  let ready = devices.filter((d) => d.state === 'device');
  if (ready.length === 0) {
    adb.run(['connect', CONNECT_FALLBACK], { allowFail: true });
    devices = listDevices(adb);
    ready = devices.filter((d) => d.state === 'device');
  }

  if (ready.length === 0) {
    const unauthorized = devices.find((d) => d.state === 'unauthorized');
    if (unauthorized) {
      throw new Error(
        `The emulator ${unauthorized.serial} is attached but has not allowed this computer to ` +
          'control it. Approve the debugging prompt inside the emulator and run this again.'
      );
    }
    throw new Error(
      'No emulator is running. Start the Google Play Games Developer Emulator, wait for the ' +
        'home screen, then run this again.'
    );
  }

  if (ready.length === 1) return ready[0].serial;

  const preferred = ready.find((d) => d.serial === CONNECT_FALLBACK);
  if (preferred) return preferred.serial;

  throw new Error(
    'More than one device is attached: ' +
      ready.map((d) => d.serial).join(', ') +
      '. Run this again with --device followed by the one you want.'
  );
}
export function packageVersion(adb, pkg = GAME_PACKAGE) {
  const output = adb.shell(`dumpsys package ${pkg}`, { allowFail: true, timeout: 20000 });
  const match = output.match(/versionName=([^\s\r\n]+)/);
  return match ? match[1] : null;
}

export function isPackageInstalled(adb, pkg = GAME_PACKAGE) {
  const output = adb.shell(`pm list packages ${pkg}`, { allowFail: true });
  return output.split(/\r?\n/).some((line) => line.trim() === `package:${pkg}`);
}
export function isGameRunning(adb, pkg = GAME_PACKAGE) {
  const pids = adb.shell(`pidof ${pkg}`, { allowFail: true }).trim();
  if (/^\d+(\s+\d+)*$/.test(pids)) return true;
  const ps = adb.shell(`ps -A -o NAME`, { allowFail: true });
  return ps.split(/\r?\n/).some((line) => line.trim() === pkg);
}
export function defaultGateway(adb) {
  const output = adb.shell('ip route show table all', { allowFail: true });
  const match = output.match(/default via ((?:\d{1,3}\.){3}\d{1,3})\b/);
  return match ? match[1] : null;
}
export function deviceSubnetHostGuess(adb) {
  const output = adb.shell('ip route', { allowFail: true });
  const match = output.match(/src ((?:\d{1,3}\.){3})\d{1,3}/);
  return match ? `${match[1]}2` : null;
}
export function readProxySettings(adb) {
  const snapshot = {};
  for (const key of PROXY_KEYS) {
    snapshot[key] = adb.shell(`settings get global ${key}`, { allowFail: true }).trim();
  }
  return snapshot;
}

function settingsWriteCommand(key, value) {
  if (value === 'null') return `settings delete global ${key}`;
  if (value === '') {
    return `settings put global ${key} ""`;
  }
  if (!/^[A-Za-z0-9._:,/\-[\]]+$/.test(value)) {
    return null;
  }
  return `settings put global ${key} ${value}`;
}

export function writeProxy(adb, hostPort) {
  adb.shell(`settings put global http_proxy ${hostPort}`);
}
export function restoreProxySettings(adb, snapshot) {
  const problems = [];
  for (const key of PROXY_KEYS) {
    const value = snapshot[key];
    const command = settingsWriteCommand(key, value);
    if (command === null) {
      problems.push(
        `Could not put ${key} back automatically. Its original value was: ${value}`
      );
      continue;
    }
    try {
      adb.shell(command, { allowFail: true, timeout: 10000 });
    } catch (error) {
      problems.push(`Could not put ${key} back: ${error.message}`);
    }
  }
  return problems;
}
export function proxySettingsMatch(adb, snapshot) {
  const now = readProxySettings(adb);
  const differences = [];
  for (const key of PROXY_KEYS) {
    if (now[key] !== snapshot[key]) {
      differences.push(`${key}: expected "${snapshot[key]}" but found "${now[key]}"`);
    }
  }
  return { ok: differences.length === 0, differences, now };
}

export function restartGame(adb, pkg = GAME_PACKAGE) {
  adb.shell(`am force-stop ${pkg}`, { allowFail: true });
  adb.shell(
    `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`,
    { allowFail: true, timeout: 20000 }
  );
}
export async function restartGameAsync(adb, pkg = GAME_PACKAGE) {
  await adb.shellAsync(`am force-stop ${pkg}`, { allowFail: true });
  await adb.shellAsync(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, {
    allowFail: true,
    timeout: 20000,
  });
}

export function stopGame(adb, pkg = GAME_PACKAGE) {
  adb.shell(`am force-stop ${pkg}`, { allowFail: true });
}

export { PROXY_KEYS, CONNECT_FALLBACK, OFFICIAL_ADB };
