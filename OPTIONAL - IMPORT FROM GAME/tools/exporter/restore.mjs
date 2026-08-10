#!/usr/bin/env node

import { discoverAdb } from './adb.mjs';
import {
  RECOVERY_PATH,
  readRecovery,
  recoverInterruptedRun,
  recoveryLines,
} from './proxy-state.mjs';

const HELP = `Put the Mini Heroes emulator network setting back

  node restore.mjs [options]

Options
  --adb PATH               use this adb program, instead of finding one
  --help                   show this

If the exporter was interrupted it leaves a note beside it, and this puts back
exactly the values that note recorded. With no note, there is no interrupted
capture record to restore, so this changes nothing.
`;

function parseArgs(argv) {
  const options = { adb: null, help: false };
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
      default:
        throw new Error(`I do not know the option ${arg}. Run with --help to see the list.`);
    }
  }
  return options;
}

function say(message) {
  process.stdout.write(`  ${message}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  process.stdout.write('\nMini Heroes: put the emulator network back\n\n');
  const note = readRecovery();
  if (note === null) {
    say('There is no interrupted capture record here. Nothing was changed.');
    process.stdout.write('\n');
    return 0;
  }
  if (note.unreadable) {
    say(`There is a note here from an interrupted run and I cannot read it: ${note.unreadable}`);
    say(`It has been kept at ${RECOVERY_PATH}. Nothing was changed.`);
    process.stdout.write('\n');
    return 1;
  }

  const adbPath = discoverAdb(options.adb);
  const result = recoverInterruptedRun(adbPath);
  for (const line of recoveryLines(result)) say(line);
  process.stdout.write('\n');
  return result.state === 'restored' ? 0 : 1;
}

try {
  process.exit(main());
} catch (error) {
  process.stdout.write(`\n  ${error.message}\n\n`);
  process.exit(1);
}
