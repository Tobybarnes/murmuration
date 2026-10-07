import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checked = 0;
async function checkDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) {
      await checkDirectory(file);
      continue;
    }
    if (!entry.isFile() || !/\.m?js$/.test(entry.name)) continue;
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
    checked++;
  }
}
for (const dir of ['src', 'scripts', 'tests', 'api']) {
  try {
    await checkDirectory(new URL(`../${dir}/`, import.meta.url));
  } catch (error) {
    if (error.code !== 'ENOENT' || dir !== 'api') throw error;
  }
}
console.log(`JavaScript syntax checks passed (${checked} files, including nested modules).`);
