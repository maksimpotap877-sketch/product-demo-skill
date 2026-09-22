import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applicationRoot, installSkill, skillStatus, skillTargets, uninstallSkill, validatePackageEntries, parsePackResult } from '../src/install.js';

test('package parsing accepts npm 11 and npm 12 manifests and rejects mixed/private entries',()=>{
 const item={name:'product-demo-toolkit',version:'0.3.0',filename:'product-demo-toolkit-0.3.0.tgz',files:[{path:'dist/cli.js'}]};
 assert.deepEqual(parsePackResult(JSON.stringify([item])),item);
 assert.deepEqual(parsePackResult(JSON.stringify({'product-demo-toolkit':item})),item);
 for(const invalid of [[],{},[item,item],{foreign:{...item,name:'other'}},[{...item,filename:'../escape.tgz'}],[{...item,files:[{path:'.env'}]}]])assert.throws(()=>parsePackResult(JSON.stringify(invalid)));
});

test('package allowlist accepts runtime and rejects private/generated or escaping resources', () => {
  assert.doesNotThrow(() => validatePackageEntries(['dist/cli.js', 'src/render/Composition.tsx', 'skills/product-demo/SKILL.md', 'scripts/tts.ps1', 'npm-shrinkwrap.json', 'CODEX.md', 'CLAUDE.md', 'CHANGELOG.md']));
  for (const file of ['.env', 'output/demo.mp4', 'dist/.env.local', 'skills/product-demo/profile/auth.json', 'auth/state.json', '../dist/cli.js', 'C:/private/key.pem', 'dist/secret.key', 'examples/other-project/index.html', 'PRIVATE_INSTRUCTIONS.md', 'AGENTS.md']) {
    assert.throws(() => validatePackageEntries([file]), /package|Private|media|secret/i, file);
  }
});

test('uninstall preserves modified owned Skill and user data, and refuses an unowned Skill', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'product-demo-install-'));
  const saved = { root: process.env.PRODUCT_DEMO_DATA_DIR, home: process.env.PRODUCT_DEMO_TEST_HOME };
  process.env.PRODUCT_DEMO_DATA_DIR = path.join(temporary, 'application data');
  process.env.PRODUCT_DEMO_TEST_HOME = path.join(temporary, 'пользователь');
  const skill = path.join(process.env.PRODUCT_DEMO_TEST_HOME, '.agents', 'skills', 'product-demo');
  try {
    await mkdir(skill, { recursive: true });
    await writeFile(path.join(skill, 'SKILL.md'), 'User changed this');
    await assert.rejects(uninstallSkill(), /unowned/);
    await writeFile(path.join(skill, '.product-demo-install.json'), JSON.stringify({ schemaVersion: 1, owner: 'product-demo-toolkit', version: '0.1.0', files: {} }));
    await mkdir(path.join(applicationRoot(), 'auth'), { recursive: true });
    const session = path.join(applicationRoot(), 'auth', 'session.txt');
    await writeFile(session, 'preserved auth');
    const result = await uninstallSkill();
    assert.equal(result.removed, true);
    assert.equal(await readFile(path.join(result.backupPath as string, 'SKILL.md'), 'utf8'), 'User changed this');
    assert.equal(await readFile(session, 'utf8'), 'preserved auth');
    assert.equal((await skillStatus()).installed, false);
    assert.equal((await uninstallSkill()).removed, false);
  } finally {
    if (saved.root === undefined) delete process.env.PRODUCT_DEMO_DATA_DIR; else process.env.PRODUCT_DEMO_DATA_DIR = saved.root;
    if (saved.home === undefined) delete process.env.PRODUCT_DEMO_TEST_HOME; else process.env.PRODUCT_DEMO_TEST_HOME = saved.home;
    await rm(temporary, { recursive: true, force: true });
  }
});

test('launcher resolves manifest and preserves arguments and project cwd with spaces and Cyrillic', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'product-demo-launcher-'));
  const runtime = path.join(temporary, 'runtimes', '0.1.0-fixture');
  const project = path.join(temporary, 'Второй проект');
  const cliPath = path.join(runtime, 'cli.mjs');
  try {
    await mkdir(runtime, { recursive: true }); await mkdir(project, { recursive: true });
    await writeFile(cliPath, 'process.stdout.write(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));');
    await writeFile(path.join(temporary, 'install.json'), JSON.stringify({ schemaVersion: 1, owner: 'product-demo-toolkit', runtimePath: runtime, cliPath }));
    const result = spawnSync(process.execPath, [path.resolve('skills/product-demo/scripts/run.mjs'), '--project', project, 'literal $(nothing); & text'], { cwd: project, env: { ...process.env, PRODUCT_DEMO_DATA_DIR: temporary }, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { cwd: project, args: ['--project', project, 'literal $(nothing); & text'] });
    const installedSkill=path.join(temporary,'skill');await mkdir(path.join(installedSkill,'scripts'),{recursive:true});
    await copyFile(path.resolve('skills/product-demo/scripts/run.mjs'),path.join(installedSkill,'scripts/run.mjs'));
    await writeFile(path.join(installedSkill,'.runtime-location.json'),JSON.stringify({schemaVersion:1,owner:'product-demo-toolkit',manifestPath:realpathSync.native(path.join(temporary,'install.json'))}));
    const located=spawnSync(process.execPath,[path.join(installedSkill,'scripts/run.mjs'),'physical-locator'],{cwd:project,env:{...process.env,PRODUCT_DEMO_DATA_DIR:'',LOCALAPPDATA:path.join(temporary,'different-app-context')},encoding:'utf8',windowsHide:true});
    assert.equal(located.status,0,located.stderr);
    assert.deepEqual(JSON.parse(located.stdout),{cwd:project,args:['physical-locator']});
    await writeFile(path.join(temporary, 'install.json'), JSON.stringify({ schemaVersion: 1, owner: 'product-demo-toolkit', runtimePath: temporary, cliPath: path.resolve('skills/product-demo/scripts/run.mjs') }));
    const rejected = spawnSync(process.execPath, [path.resolve('skills/product-demo/scripts/run.mjs')], { env: { ...process.env, PRODUCT_DEMO_DATA_DIR: temporary }, encoding: 'utf8', windowsHide: true });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /outside the installed runtime/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('client target selection is explicit and project-local paths stay distinct', () => {
  const project = path.resolve('fixture project');
  assert.deepEqual(skillTargets({scope:'project',project,client:'both'}),[
    {client:'codex',scope:'project',path:path.join(project,'.agents','skills','product-demo')},
    {client:'claude',scope:'project',path:path.join(project,'.claude','skills','product-demo')},
  ]);
  assert.equal(skillTargets()[0].client,'codex');
  assert.throws(()=>skillTargets({client:'glm' as any}),/client must be/);
  assert.throws(()=>skillTargets({scope:'global' as any}),/scope must be/);
});

test('dual-client ownership preflight and uninstall preserve the other client and shared runtime', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(),'product-demo-clients-'));
  const saved = {root:process.env.PRODUCT_DEMO_DATA_DIR,home:process.env.PRODUCT_DEMO_TEST_HOME};
  process.env.PRODUCT_DEMO_DATA_DIR=path.join(temporary,'application data');
  process.env.PRODUCT_DEMO_TEST_HOME=path.join(temporary,'пользователь');
  try {
    const [codex,claude]=skillTargets({client:'both'});
    const marker={schemaVersion:1,owner:'product-demo-toolkit',version:'0.2.0',files:{}};
    for(const target of [codex,claude]){await mkdir(target.path,{recursive:true});await writeFile(path.join(target.path,'SKILL.md'),target.client+' user changes');}
    await writeFile(path.join(codex.path,'.product-demo-install.json'),JSON.stringify(marker));
    await assert.rejects(uninstallSkill({client:'both'}),/unowned/);
    await assert.rejects(installSkill({client:'both'}),/unowned/);
    assert.equal(await readFile(path.join(codex.path,'SKILL.md'),'utf8'),'codex user changes');
    await writeFile(path.join(claude.path,'.product-demo-install.json'),JSON.stringify(marker));
    const runtime=path.join(applicationRoot(),'runtimes','fixture');await mkdir(runtime,{recursive:true});
    const cliPath=path.join(runtime,'cli.mjs');await writeFile(cliPath,'// retained');
    await writeFile(path.join(applicationRoot(),'install.json'),JSON.stringify({schemaVersion:1,owner:'product-demo-toolkit',version:'0.2.0',runtimePath:runtime,cliPath,skills:[codex,claude]}));
    const status=await skillStatus({client:'both'});assert.equal(status.status,'passed');
    for(const client of status.clients as any[])assert.deepEqual(client.duplicates,[]);
    const removed=await uninstallSkill({client:'claude'});assert.equal(removed.removed,true);
    assert.equal(await readFile(path.join(removed.backupPath as string,'SKILL.md'),'utf8'),'claude user changes');
    assert.equal((await skillStatus({client:'codex'})).installed,true);
    assert.equal(await readFile(cliPath,'utf8'),'// retained');
    const manifest=JSON.parse(await readFile(path.join(applicationRoot(),'install.json'),'utf8'));assert.deepEqual(manifest.skills,[codex]);
    await uninstallSkill({client:'both'});assert.equal((await skillStatus({client:'both'})).installed,false);
    assert.equal(await readFile(cliPath,'utf8'),'// retained');
  } finally {
    if(saved.root===undefined)delete process.env.PRODUCT_DEMO_DATA_DIR;else process.env.PRODUCT_DEMO_DATA_DIR=saved.root;
    if(saved.home===undefined)delete process.env.PRODUCT_DEMO_TEST_HOME;else process.env.PRODUCT_DEMO_TEST_HOME=saved.home;
    await rm(temporary,{recursive:true,force:true});
  }
});
