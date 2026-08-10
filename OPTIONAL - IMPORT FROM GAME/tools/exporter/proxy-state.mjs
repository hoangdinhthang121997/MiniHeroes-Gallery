
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  Adb,
  PROXY_KEYS,
  listDevices,
  proxySettingsMatch,
  readProxySettings,
  restoreProxySettings,
} from './adb.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RECOVERY_PATH = path.join(HERE, '.proxy-state.json');
export function describeValue(value) {
  if (value === 'null') return 'not set';
  if (value === '') return 'set to nothing';
  return value;
}

export function writeRecovery(serial, settings) {
  const existing = readRecovery();
  if (existing && existing.unreadable) {
    throw new Error(`Cannot overwrite the unreadable recovery note at ${RECOVERY_PATH}.`);
  }
  const record = {
    tool: 'hero-gallery-exporter',
    savedAt: new Date().toISOString(),
    serial,
    settings: {},
  };
  for (const key of PROXY_KEYS) record.settings[key] = settings[key];
  const text = `${JSON.stringify(record, null, 2)}\n`;
  const directory = path.dirname(RECOVERY_PATH);
  const name = path.basename(RECOVERY_PATH);
  const temporary = path.join(directory, `.${name}.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, RECOVERY_PATH);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
    }
  }
  return RECOVERY_PATH;
}

export function deleteRecovery() {
  try {
    fs.rmSync(RECOVERY_PATH, { force: true });
    return true;
  } catch {
    return false;
  }
}
export function readRecovery() {
  let text;
  try {
    text = fs.readFileSync(RECOVERY_PATH, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    return { unreadable: error.message || 'the note could not be read' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { unreadable: error.message };
  }
  if (!parsed || typeof parsed.serial !== 'string' || parsed.serial === '') {
    return { unreadable: 'it does not say which emulator it belongs to' };
  }
  const settings = {};
  for (const key of PROXY_KEYS) {
    const value = parsed.settings ? parsed.settings[key] : undefined;
    if (typeof value !== 'string') {
      return { unreadable: `it has no saved value for ${key}` };
    }
    settings[key] = value;
  }
  return {
    serial: parsed.serial,
    settings,
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
  };
}
export function recoverInterruptedRun(adbPath) {
  const saved = readRecovery();
  if (saved === null) return { state: 'absent' };
  if (saved.unreadable) return { state: 'unreadable', reason: saved.unreadable };
  const lister = new Adb(adbPath, null);
  const isAttached = () => {
    try {
      return listDevices(lister).some(
        (device) => device.serial === saved.serial && device.state === 'device'
      );
    } catch {
      return false;
    }
  };
  let attached = isAttached();
  if (!attached && saved.serial.includes(':')) {
    lister.run(['connect', saved.serial], { allowFail: true });
    attached = isAttached();
  }
  if (!attached) {
    return { state: 'device-missing', serial: saved.serial };
  }

  const adb = new Adb(adbPath, saved.serial);
  const before = readProxySettings(adb);
  const problems = restoreProxySettings(adb, saved.settings);
  const check = proxySettingsMatch(adb, saved.settings);
  if (problems.length > 0 || !check.ok) {
    return {
      state: 'failed',
      serial: saved.serial,
      settings: saved.settings,
      before,
      problems,
      differences: check.differences,
    };
  }
  deleteRecovery();
  return { state: 'restored', serial: saved.serial, settings: saved.settings, before };
}
export function recoveryLines(result) {
  if (result.state === 'absent') return [];
  if (result.state === 'unreadable') {
    return [
      'There is a leftover note here from a run that did not finish, and I could',
      `not read it: ${result.reason}`,
      RECOVERY_PATH,
    ];
  }
  if (result.state === 'device-missing') {
    return [
      'A previous run was stopped before it could put your emulator back.',
      `It was working with ${result.serial}, and that emulator is not running now.`,
      'Start that emulator and run this again. The note has been kept until then.',
      `If that emulator is gone for good, delete this file: ${RECOVERY_PATH}`,
    ];
  }
  if (result.state === 'failed') {
    const lines = [
      'A previous run was stopped before it could put your emulator back, and I',
      'could not put it back either:',
    ];
    for (const problem of result.problems) lines.push(`  ${problem}`);
    for (const difference of result.differences) lines.push(`  ${difference}`);
    lines.push(`The original values are still written down in ${RECOVERY_PATH}`);
    return lines;
  }
  const lines = [
    'A previous run was stopped before it could put your emulator back.',
    `Its settings have now been restored on ${result.serial}:`,
  ];
  for (const key of PROXY_KEYS) {
    lines.push(`  ${key} is ${describeValue(result.settings[key])}`);
  }
  return lines;
}
