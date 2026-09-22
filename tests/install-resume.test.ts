import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {makeExampleConfig} from '../src/discovery.js';
import {hash} from '../src/util.js';

test('resume reads external saved JSON without importing config or overwriting edited storyboard', async () => {
 const temporary=await mkdtemp(path.join(tmpdir(),'product-demo-resume-'));
 const project=path.join(temporary,'Исходный проект'), run=path.join(temporary,'Внешние результаты','run-demo');
 try{
  await mkdir(path.join(run,'narration'),{recursive:true});
  const cfg=makeExampleConfig(project,'second');const story={...cfg.storyboard,title:'Пользовательская правка'};
  const text=JSON.stringify(story);
  await writeFile(path.join(run,'resolved-config.json'),JSON.stringify(cfg));
  await writeFile(path.join(run,'storyboard.json'),text);
  await writeFile(path.join(run,'checkpoint.json'),JSON.stringify({stage:'render',status:'failed'}));
  await writeFile(path.join(run,'narration/narration-manifest.json'),JSON.stringify({sourceHash:hash(text)}));
  const command=[path.resolve('node_modules/tsx/dist/cli.mjs'),path.resolve('src/cli.ts'),'resume','--run',run,'--dry-run','--json'];
  const result=spawnSync(process.execPath,command,{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr+result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).steps,['render','inspect']);
  assert.equal(await readFile(path.join(run,'storyboard.json'),'utf8'),text);
  const changed=spawnSync(process.execPath,[...command,'--voice','male'],{encoding:'utf8',windowsHide:true});
  assert.equal(changed.status,0,changed.stderr+changed.stdout);
  assert.deepEqual(JSON.parse(changed.stdout).steps,['narrate','plan','render','inspect']);
  assert.equal(JSON.parse(await readFile(path.join(run,'resolved-config.json'),'utf8')).voice,'female');
 }finally{await rm(temporary,{recursive:true,force:true});}
});

test('init and omitted config voice honor saved preference, while explicit CLI voice wins', async () => {
 const temporary=await mkdtemp(path.join(tmpdir(),'product-demo-preference-'));
 const project=path.join(temporary,'project'), data=path.join(temporary,'data');
 try{
  await mkdir(project,{recursive:true});await mkdir(data,{recursive:true});
  await writeFile(path.join(data,'narration-preferences.json'),JSON.stringify({voice:'male'}));
  const cfg:any=makeExampleConfig(project,'second');delete cfg.voice;
  await writeFile(path.join(project,'demo.config.json'),JSON.stringify(cfg));
  const run=(args:string[])=>spawnSync(process.execPath,[path.resolve('node_modules/tsx/dist/cli.mjs'),path.resolve('src/cli.ts'),...args,'--dry-run','--json'],{encoding:'utf8',windowsHide:true,env:{...process.env,PRODUCT_DEMO_DATA_DIR:data}});
  const implicit=run(['all','--project',project]);assert.equal(implicit.status,0,implicit.stderr);assert.equal(JSON.parse(implicit.stdout).config.voice,'male');
  const explicit=run(['all','--project',project,'--voice','female','--no-save-voice-preference']);assert.equal(explicit.status,0,explicit.stderr);assert.equal(JSON.parse(explicit.stdout).config.voice,'female');
  const initialized=run(['init','--project',path.join(temporary,'new-project'),'--example','second']);assert.equal(initialized.status,0,initialized.stderr);assert.equal(JSON.parse(initialized.stdout).config.voice,'male');
  assert.equal(JSON.parse(await readFile(path.join(data,'narration-preferences.json'),'utf8')).voice,'male');
 }finally{await rm(temporary,{recursive:true,force:true});}
});
