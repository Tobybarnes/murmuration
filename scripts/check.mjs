import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const dir of ['src', 'scripts', 'tests']) {
  for (const entry of await readdir(new URL(`../${dir}/`, import.meta.url))) {
    if (!/\.m?js$/.test(entry)) continue;
    const result = spawnSync(process.execPath, ['--check', `${dir}/${entry}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('JavaScript syntax checks passed.');
