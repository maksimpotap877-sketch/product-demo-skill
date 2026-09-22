import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = 'product-demo-toolkit';
const SKILL = 'product-demo';
type PackResult = {name:string;version:string;filename:string;files:{path:string}[]};
/** npm 11 emits an array; npm 12 emits a package-name keyed object. */
export function parsePackResult(output:string):PackResult {
  const parsed:unknown=JSON.parse(output);
  const entries=Array.isArray(parsed)?parsed:parsed&&typeof parsed==='object'?Object.values(parsed):[];
  const item=entries[0];
  if(entries.length!==1||!item||item.name!==OWNER||typeof item.version!=='string'||typeof item.filename!=='string'||!/^product-demo-toolkit-[a-zA-Z0-9.+-]+\.tgz$/.test(item.filename)||!Array.isArray(item.files)||!item.files.length||item.files.some((file:any)=>!file||typeof file.path!=='string'))throw new Error('npm returned an unexpected package manifest.');
  validatePackageEntries(item.files.map((file:{path:string})=>file.path));
  return item;
}
export type SkillClient = 'codex' | 'claude';
export type InstallOptions = { scope?: 'user' | 'project'; project?: string; client?: SkillClient | 'both' };
type SkillTarget = { client: SkillClient; path: string; scope: 'user' | 'project' };
type OwnedSkill = { schemaVersion: 1; owner: string; version: string; files: Record<string, string> };
type InstallManifest = {
  schemaVersion: 1; owner: string; version: string; installedAt: string;
  runtimePath: string; cliPath: string; packagePath: string; packageSha256: string;
  skills: { path: string; scope: 'user' | 'project'; client?: SkillClient }[];
};

export function applicationRoot(): string {
  if (process.env.PRODUCT_DEMO_DATA_DIR) return resolve(process.env.PRODUCT_DEMO_DATA_DIR);
  if (platform() === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), OWNER);
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', OWNER);
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), OWNER);
}

function userHome(): string { return process.env.PRODUCT_DEMO_TEST_HOME ? resolve(process.env.PRODUCT_DEMO_TEST_HOME) : homedir(); }
export function skillTargets(options: InstallOptions = {}): SkillTarget[] {
  if (options.scope && !['user', 'project'].includes(options.scope)) throw new Error('Skill scope must be user or project.');
  if (options.client && !['codex', 'claude', 'both'].includes(options.client)) throw new Error('Skill client must be codex, claude or both.');
  const clients: SkillClient[] = options.client === 'both' ? ['codex', 'claude'] : [options.client || 'codex'];
  const scope = options.scope || 'user';
  return clients.map(client => {
    const root = scope === 'project' ? join(resolve(options.project || process.cwd()), client === 'codex' ? '.agents' : '.claude')
      : client === 'claude' && !process.env.PRODUCT_DEMO_TEST_HOME && process.env.CLAUDE_CONFIG_DIR
        ? resolve(process.env.CLAUDE_CONFIG_DIR) : join(userHome(), client === 'codex' ? '.agents' : '.claude');
    return { client, scope, path: join(root, 'skills', SKILL) };
  });
}
function packageRoot(): string { return resolve(dirname(fileURLToPath(import.meta.url)), '..'); }
function sha(data: string | Buffer): string { return createHash('sha256').update(data).digest('hex'); }
function assertInside(root: string, target: string): void {
  const within = relative(resolve(root), resolve(target));
  if (!within || within.startsWith(`..${sep}`) || within === '..' || isAbsolute(within)) throw new Error(`Unsafe owned path: ${target}`);
}
async function json<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T; }
async function optionalJson<T>(path: string): Promise<T | undefined> {
  try { return await json<T>(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

/** Deliberately narrow: generated media, auth, outputs and arbitrary project files cannot enter a package. */
export function validatePackageEntries(entries: string[]): void {
  for (const entry of entries) {
    const path = entry.replaceAll('\\', '/');
    if (!path || isAbsolute(path) || path.split('/').includes('..') || path.includes(':')) throw new Error(`Unsafe package path: ${entry}`);
    if (/(^|\/)(node_modules|output|outputs|runs|auth|profile|profiles|\.git|\.env[^/]*|\.npmrc)(\/|$)/i.test(path)) throw new Error(`Private or generated path in package: ${entry}`);
    const allowed = /^(package\.json|package-lock\.json|npm-shrinkwrap\.json|README(?:\.md)?|LICENSE(?:\.md|\.txt)?|THIRD_PARTY_NOTICES\.md|CODEX\.md|CLAUDE\.md|CHANGELOG\.md)$/.test(path)
      || /^(dist|schemas|docs)\//.test(path)
      || /^src\/render\//.test(path)
      || /^skills\/product-demo\//.test(path)
      || /^examples\/(basic-web|second-web)\//.test(path)
      || path === 'examples/server.mjs'
      || /^scripts\/tts[^/]*\.(?:ps1|py|mjs|js)$/.test(path);
    if (!allowed) throw new Error(`Unexpected package file (not allowlisted): ${entry}`);
    if (/\.(mp4|webm|wav|mp3|har|log|tgz|zip|pem|key|pfx|p12)$/i.test(path)) throw new Error(`User media or secret-like file in package: ${entry}`);
  }
}

function npmCli(): string {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  for (const candidate of candidates) if (candidate && candidate.endsWith('.js') && existsSync(candidate)) return candidate;
  throw new Error('npm-cli.js was not found beside Node.js. Run this command through npm, or install the supported Node.js distribution with npm.');
}

async function npm(args: string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [npmCli(), ...args], { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('npm operation timed out after 10 minutes. Existing installation remains usable.')); }, 600_000);
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolvePromise(stdout) : reject(new Error(`npm ${args[0]} failed (${code}): ${stderr.slice(-3000)}`)); });
  });
}

async function filesUnder(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not permitted in owned package/Skill resources: ${path}`);
    if (entry.isDirectory()) paths.push(...await filesUnder(directory, path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}

async function ownedHashes(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const path of await filesUnder(directory)) if (path !== '.product-demo-install.json') result[path] = sha(await readFile(join(directory, path)));
  return result;
}

export async function packRuntime(source = packageRoot()): Promise<{ path: string; hash: string; version: string; entries: string[] }> {
  const meta = await json<{ name: string; version: string }>(join(source, 'package.json'));
  if (meta.name !== OWNER || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(meta.version)) throw new Error('Unexpected toolkit package identity.');
  if (!existsSync(join(source, 'dist', 'cli.js'))) throw new Error('Build the toolkit before installing its Skill (npm run build).');
  const base = applicationRoot();
  const temporary = join(base, 'staging', randomUUID());
  await mkdir(temporary, { recursive: true });
  try {
    const dry = parsePackResult(await npm(['pack', '--dry-run', '--json', '--ignore-scripts'], source));
    const entries = dry.files.map(file => file.path);
    validatePackageEntries(entries);
    for (const path of entries) {
      const origin = join(source, path);
      if ((await stat(origin)).isFile()) {
        await mkdir(dirname(join(temporary, path)), { recursive: true });
        await cp(origin, join(temporary, path), { dereference: false });
      }
    }
    // npm intentionally omits package-lock.json from tarballs; shrinkwrap preserves the tested dependency tree.
    const lockPath = existsSync(join(source, 'package-lock.json')) ? join(source, 'package-lock.json') : join(source, 'npm-shrinkwrap.json');
    if (!existsSync(lockPath)) throw new Error('A tested dependency lockfile is required for portable installation.');
    await cp(lockPath, join(temporary, 'npm-shrinkwrap.json'));
    const stagedMeta = await json<Record<string, unknown>>(join(temporary, 'package.json'));
    delete stagedMeta.scripts;
    stagedMeta.files = [...new Set([...entries, 'npm-shrinkwrap.json'])];
    await writeJson(join(temporary, 'package.json'), stagedMeta);
    const packages = join(base, 'packages');
    await mkdir(packages, { recursive: true });
    const result = parsePackResult(await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], temporary));
    validatePackageEntries(result.files.map(file => file.path));
    const bytes = await readFile(join(temporary, result.filename));
    const hash = sha(bytes);
    const archivePath = join(packages, `${OWNER}-${meta.version}-${hash.slice(0, 12)}.tgz`);
    if (!existsSync(archivePath)) await writeFile(archivePath, bytes);
    await writeJson(`${archivePath}.manifest.json`, { schemaVersion: 1, name: OWNER, version: meta.version, sha256: hash, files: result.files.map(file => file.path) });
    return { path: archivePath, hash, version: meta.version, entries: result.files.map(file => file.path) };
  } finally {
    // This is our freshly created UUID staging directory, never a project or user-selected target.
    assertInside(join(base, 'staging'), temporary);
    await rm(temporary, { recursive: true, force: true });
  }
}

async function duplicateSkills(destination: string, project = process.cwd(), client: SkillClient = 'codex'): Promise<string[]> {
  const candidates = [skillTargets({client,scope:'user'})[0].path, skillTargets({client,scope:'project',project})[0].path];
  if (client === 'codex') candidates.push(join(userHome(), '.codex', 'skills', SKILL));
  return [...new Set(candidates)].filter(path => resolve(path) !== resolve(destination) && existsSync(join(path, 'SKILL.md')));
}

async function moveOwnedSkill(source: string, backup: string): Promise<void> {
  if (relative(dirname(source), source) !== SKILL) throw new Error('Unsafe Skill move target.');
  assertInside(join(applicationRoot(), 'backups'), backup);
  try { await rename(source, backup); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(source, backup, { recursive: true, errorOnExist: true, force: false });
    // A project Skill can be on another drive. Verify the complete backup before removing its original.
    if (JSON.stringify(await ownedHashes(source)) !== JSON.stringify(await ownedHashes(backup))) throw new Error('Skill backup did not verify; original preserved.');
    assertInside(dirname(source), source);
    await rm(source, { recursive: true });
  }
}

export async function installSkill(options: InstallOptions = {}): Promise<Record<string, unknown>> {
  const targets = skillTargets(options);
  for (const target of targets) {
    const duplicates = await duplicateSkills(target.path, options.project, target.client);
    if (duplicates.length) throw new Error(`A ${target.client} product-demo Skill already exists at ${duplicates.join(', ')}. Use that installation or remove it explicitly before installing another scope.`);
    if (existsSync(target.path) && (await optionalJson<OwnedSkill>(join(target.path, '.product-demo-install.json')))?.owner !== OWNER) throw new Error(`Refusing to replace an unowned Skill: ${target.path}`);
  }
  const packed = await packRuntime();
  const base = applicationRoot();
  const runtimeBase = join(base, 'runtimes', `${packed.version}-${packed.hash.slice(0, 12)}`);
  const runtime = join(runtimeBase, 'node_modules', OWNER);
  const runtimeMarker = join(runtimeBase, '.product-demo-runtime.json');
  const previousRuntime = await optionalJson<{ packageSha256: string }>(runtimeMarker);
  const reusedRuntime = previousRuntime?.packageSha256 === packed.hash && existsSync(join(runtime, 'dist', 'cli.js'));
  if (!reusedRuntime) {
    if (existsSync(runtimeBase)) throw new Error(`Incomplete runtime already exists at ${runtimeBase}; it was preserved for diagnosis. Rename that specific directory and retry.`);
    await mkdir(runtimeBase, { recursive: true });
    await writeJson(join(runtimeBase, 'package.json'), { name: 'product-demo-runtime', version: '1.0.0', private: true });
    try {
      await npm(['install', packed.path, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '--package-lock=true'], runtimeBase);
      if (!existsSync(join(runtime, 'dist', 'cli.js'))) throw new Error('Installed runtime has no CLI entrypoint.');
      await writeJson(runtimeMarker, { owner: OWNER, packageSha256: packed.hash, version: packed.version });
    } catch (error) { throw new Error(`Runtime installation failed; the previous manifest was not changed. ${String(error)}`); }
  }
  const incoming = join(runtime, 'skills', SKILL);
  // Native realpath resolves Windows MSIX virtualization, unlike the legacy JS realpath implementation.
  // Store a stable physical manifest locator so this Skill also launches outside the installing app.
  const canonicalBase = realpathSync.native(base);
  const manifestPath = join(canonicalBase, 'install.json');
  const locationContents = `${JSON.stringify({schemaVersion:1,owner:OWNER,manifestPath},null,2)}\n`;
  const baseHashes = {...await ownedHashes(incoming), '.runtime-location.json': sha(locationContents)};
  const incomingHashes = Object.fromEntries(Object.keys(baseHashes).sort().map(key=>[key,baseHashes[key as keyof typeof baseHashes]]));
  const installations: {client: SkillClient; skillPath: string; reusedSkill: boolean; editedFilesBackup?: string}[] = [];
  for (const target of targets) {
  const destination = target.path;
  const markerPath = join(destination, '.product-demo-install.json');
  const previous = await optionalJson<OwnedSkill>(markerPath);
  let backupPath: string | undefined;
  let reusedSkill = false;
  if (existsSync(destination)) {
    const current = await ownedHashes(destination);
    const changed = !previous || previous.owner !== OWNER || JSON.stringify(current) !== JSON.stringify(previous.files);
    reusedSkill = !changed && JSON.stringify(current) === JSON.stringify(incomingHashes);
    if (changed) {
      backupPath = join(base, 'backups', `skill-${Date.now()}-${randomUUID().slice(0, 8)}`);
      await mkdir(dirname(backupPath), { recursive: true });
      await cp(destination, backupPath, { recursive: true, errorOnExist: true, force: false });
    }
  }
  if (!reusedSkill) {
    const stagingSkill = join(dirname(destination), `.product-demo-stage-${randomUUID()}`);
    await mkdir(dirname(destination), { recursive: true });
    await cp(incoming, stagingSkill, { recursive: true });
    await writeFile(join(stagingSkill,'.runtime-location.json'),locationContents,'utf8');
    await writeJson(join(stagingSkill, '.product-demo-install.json'), { schemaVersion: 1, owner: OWNER, version: packed.version, files: incomingHashes } satisfies OwnedSkill);
    if (existsSync(destination)) {
      const old = join(base, 'backups', `replaced-${Date.now()}-${randomUUID().slice(0, 8)}`);
      await mkdir(dirname(old), { recursive: true });
      await moveOwnedSkill(destination, old);
    }
    assertInside(dirname(destination), stagingSkill);
    await rename(stagingSkill, destination);
  }
  installations.push({client:target.client,skillPath:destination,reusedSkill,...(backupPath?{editedFilesBackup:backupPath}:{})});
  }
  const priorManifest = await optionalJson<InstallManifest>(manifestPath);
  const skills = (priorManifest?.skills || []).filter(skill => !targets.some(target=>resolve(skill.path) === resolve(target.path)));
  skills.push(...targets);
  const physicalRuntime = realpathSync.native(runtime);
  const physicalPackage = realpathSync.native(packed.path);
  const manifest: InstallManifest = { schemaVersion: 1, owner: OWNER, version: packed.version, installedAt: new Date().toISOString(), runtimePath: physicalRuntime,
    cliPath: join(physicalRuntime, 'dist', 'cli.js'), packagePath: physicalPackage, packageSha256: packed.hash, skills };
  await writeJson(manifestPath, manifest);
  return { status: 'passed', client: options.client || 'codex', skillPath: targets[0].path, skillPaths: targets.map(target=>target.path), installations,
    runtimePath: physicalRuntime, manifestPath, packagePath: physicalPackage, packageSha256: packed.hash, reusedRuntime, reusedSkill: installations.every(item=>item.reusedSkill),
    ...(installations.length===1&&installations[0].editedFilesBackup?{editedFilesBackup:installations[0].editedFilesBackup}:{}),
    duplicates: [], discovery: 'Installed in the selected client Skill directories; refresh the client and verify product-demo is discoverable.' };
}

export async function skillStatus(options: InstallOptions = {}): Promise<Record<string, unknown>> {
  const targets = skillTargets(options);
  if (targets.length > 1) {
    const clients = await Promise.all(targets.map(target=>skillStatus({...options,client:target.client})));
    return {status:clients.every(result=>result.status==='passed')?'passed':'not-tested',client:'both',installed:clients.every(result=>result.installed),runtimeReady:clients.every(result=>result.runtimeReady),clients,skillPaths:targets.map(target=>target.path)};
  }
  const destination = targets[0].path;
  const manifestPath = join(applicationRoot(), 'install.json');
  const manifest = await optionalJson<InstallManifest>(manifestPath);
  const ownership = await optionalJson<OwnedSkill>(join(destination, '.product-demo-install.json'));
  const installed = existsSync(join(destination, 'SKILL.md'));
  const runtimeReady = !!manifest && existsSync(manifest.cliPath);
  const modified = installed && ownership?.owner === OWNER ? JSON.stringify(await ownedHashes(destination)) !== JSON.stringify(ownership.files) : installed;
  return { status: installed && runtimeReady ? 'passed' : 'not-tested', client: targets[0].client, installed, runtimeReady, modified, owned: ownership?.owner === OWNER,
    skillPath: destination, manifestPath, runtimePath: manifest?.runtimePath, version: manifest?.version, duplicates: await duplicateSkills(destination, options.project, targets[0].client) };
}

export async function uninstallSkill(options: InstallOptions = {}): Promise<Record<string, unknown>> {
  const targets = skillTargets(options);
  if (targets.length > 1) {
    // Check both ownership markers before moving either client installation.
    for (const target of targets) if (existsSync(target.path) && (await optionalJson<OwnedSkill>(join(target.path,'.product-demo-install.json')))?.owner !== OWNER) throw new Error(`Refusing to remove an unowned Skill: ${target.path}`);
    const clients = [];
    for (const target of targets) clients.push(await uninstallSkill({...options,client:target.client}));
    return {status:'passed',client:'both',removed:clients.some(result=>result.removed),clients,preserved:'Runtime, auth, models, outputs, integrations and backups are retained.'};
  }
  const destination = targets[0].path;
  const marker = await optionalJson<OwnedSkill>(join(destination, '.product-demo-install.json'));
  if (!existsSync(destination)) return { status: 'passed', client:targets[0].client, skillPath:destination, removed: false, preserved: 'Runtime, auth, models, outputs, integrations and backups are retained.' };
  if (marker?.owner !== OWNER) throw new Error(`Refusing to remove an unowned Skill: ${destination}`);
  const base = applicationRoot();
  const backupPath = join(base, 'backups', `uninstalled-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await mkdir(dirname(backupPath), { recursive: true });
  const expected = skillTargets(options)[0].path;
  if (resolve(destination) !== resolve(expected) || relative(dirname(destination), destination) !== SKILL || destination === sep) throw new Error('Unsafe uninstall target.');
  // Move into our own backup instead of deleting user-modified resources.
  await moveOwnedSkill(destination, backupPath);
  const manifestPath = join(base, 'install.json');
  const manifest = await optionalJson<InstallManifest>(manifestPath);
  if (manifest) { manifest.skills = manifest.skills.filter(skill => resolve(skill.path) !== resolve(destination)); await writeJson(manifestPath, manifest); }
  return { status: 'passed', client: targets[0].client, skillPath:destination, removed: true, backupPath, preserved: 'Runtime, auth, models, outputs, integrations and backups are retained.' };
}
