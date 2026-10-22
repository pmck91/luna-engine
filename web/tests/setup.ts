import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
export default async function setup() {
  const temp = mkdtempSync(join(tmpdir(), 'luna-e2e-'));
  mkdirSync(join(temp, 'config'));
  const child = spawn(resolve('../target/debug/luna-editor'), ['--port', '0', '--no-browser'], {
    env: { ...process.env, XDG_CONFIG_HOME: join(temp, 'config') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Editor did not start: ${output}`)), 15000);
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Editor exited (${code}): ${output}`)));
    child.stderr.on('data', (b) => {
      output += b.toString();
    });
    child.stdout.on('data', (b) => {
      output += b.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[a-z0-9-]+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
  process.env.LUNA_TEST_URL = url;
  process.env.LUNA_TEST_DIR = temp;
  writeFileSync(join(temp, 'session.json'), JSON.stringify({ url, temp }));
  console.log(`Editor test workspace: ${temp}`);
  return () => {
    child.kill('SIGTERM');
  };
}
