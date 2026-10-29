import { join, resolve } from 'node:path';
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';

export const editorBinary =
  process.env.LUNA_TEST_EDITOR ||
  resolve(`../target/debug/luna-editor${process.platform === 'win32' ? '.exe' : ''}`);

export const editorConfig = (temp: string) => join(temp, 'config', 'editor.json');

const runnerBinary =
  process.env.LUNA_TEST_RUNNER ||
  resolve(`../target/debug/luna${process.platform === 'win32' ? '.exe' : ''}`);

export function execRunner(args: string[], options: ExecFileSyncOptionsWithStringEncoding) {
  return execFileSync(
    runnerBinary,
    ['--config', join(process.env.LUNA_TEST_DIR!, 'config', 'runner.toml'), ...args],
    options,
  );
}
