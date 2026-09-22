#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

function dataRoot() {
  if (process.env.PRODUCT_DEMO_DATA_DIR) return resolve(process.env.PRODUCT_DEMO_DATA_DIR);
  if (platform() === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'product-demo-toolkit');
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'product-demo-toolkit');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'product-demo-toolkit');
}

try {
  let manifestFile = join(dataRoot(), 'install.json');
  if (!process.env.PRODUCT_DEMO_DATA_DIR) {
    try {
      const location=JSON.parse(await readFile(new URL('../.runtime-location.json',import.meta.url),'utf8'));
      if(location.schemaVersion!==1||location.owner!=='product-demo-toolkit'||!isAbsolute(location.manifestPath||''))throw new Error('Invalid Skill runtime locator.');
      manifestFile=location.manifestPath;
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const root = dirname(manifestFile);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.owner !== 'product-demo-toolkit' || !isAbsolute(manifest.cliPath || '')) throw new Error('Invalid local installation manifest.');
  const runtimeRoot = realpathSync.native(join(root, 'runtimes'));
  const cliPath = realpathSync.native(manifest.cliPath);
  const within = relative(runtimeRoot, cliPath);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('CLI is outside the installed runtime directory.');
  if (process.argv[2] === '--runtime-path') {
    process.stdout.write(`${manifest.runtimePath}\n`);
  } else {
    const child = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], { cwd: process.cwd(), env: {...process.env,PRODUCT_DEMO_DATA_DIR:root}, stdio: 'inherit', shell: false, windowsHide: true });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', error => { process.stderr.write(`product-demo: ${error.message}\n`); process.exitCode = 1; });
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 130 : 1); });
  }
} catch (error) {
  process.stderr.write(`product-demo launcher: ${error.message}\nInstall the toolkit runtime with demo-video skill install --scope user. The launcher never downloads or installs dependencies automatically.\n`);
  process.exitCode = 1;
}
