import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {capture} from '../src/capture.js';
import {renderRun} from '../src/rendering.js';
import {executeReviewedStage} from '../src/execution.js';
import {DemoConfigSchema} from '../src/schema.js';
import {createUnderstandingDraft,type UnderstandingManifest} from '../src/understanding.js';

async function fixture(){
  const project=await mkdtemp(path.join(os.tmpdir(),'demo-execution-'));
  await mkdir(path.join(project,'src'));
  const source=path.join(project,'src','app.ts');
  await writeFile(source,'export const ready = "dashboard";\nexport function showDetails() { return "Product details are visible"; }\n');
  const config=DemoConfigSchema.parse({project,url:'http://127.0.0.1:1',readyLocator:{testid:'dashboard'},actions:[{type:'click',locator:{testid:'show-details'}}],storyboard:{schemaVersion:1,title:'Product details',scenes:[{sceneId:'details',displayText:'Product details',spokenText:'The product details appear.'}]}});
  const draft=await createUnderstandingDraft({project,config,sourceRequests:[{path:'src/app.ts'}]});
  const manifest:UnderstandingManifest={...draft.manifest,status:'ready',authoredBy:'Integration test author',product:{name:'Product details',purpose:'A local product overview lets a visitor open its detailed information.',audience:'Visitors evaluating the example product',primaryOutcome:'The selected product details become visible in the overview.'},safeStart:{mode:'existing',explanation:'Use the existing loopback site without starting a managed process.',evidenceIds:['source-001']},flow:[{id:'details',summary:'Open the selected product details from the overview.',actionIndexes:[0],evidenceIds:['source-001'],success:{description:'The details panel for the selected product is visible.',locator:{testid:'product-details'}}}]};
  const runDir=path.join(project,'output','run');
  const save=()=>writeFile(path.join(project,'demo.understanding.json'),JSON.stringify(manifest));
  const stale=()=>writeFile(source,'export const ready = "changed-product";\nexport function showDetails() { return "Changed behavior"; }\n');
  const prepareRender=async()=>{await mkdir(runDir,{recursive:true});await writeFile(path.join(runDir,'resolved-config.json'),JSON.stringify(config));await writeFile(path.join(runDir,'edit-plan.json'),'{}');};
  return {project,config,runDir,manifest,save,stale,prepareRender};
}

test('exported capture blocks missing analysis before creating output or opening the unavailable site',async()=>{
  const f=await fixture();
  await assert.rejects(capture(f.config,f.runDir),/understanding_blocked: analysis_missing/);
  await assert.rejects(access(f.runDir),{code:'ENOENT'});
});

test('exported capture blocks stale source evidence before capture artifacts exist',async()=>{
  const f=await fixture();await f.save();await f.stale();
  await assert.rejects(capture(f.config,f.runDir),/source_stale:source-001/);
  await assert.rejects(access(f.runDir),{code:'ENOENT'});
});

test('exported render blocks missing analysis before parsing or staging a render plan',async()=>{
  const f=await fixture();await f.prepareRender();
  await assert.rejects(renderRun(f.runDir),/understanding_blocked: analysis_missing/);
  assert.deepEqual((await readdir(f.runDir)).sort(),['edit-plan.json','resolved-config.json']);
});

test('exported render blocks stale source evidence before any render effects',async()=>{
  const f=await fixture();await f.save();await f.stale();await f.prepareRender();
  await assert.rejects(renderRun(f.runDir),/source_stale:source-001/);
  assert.deepEqual((await readdir(f.runDir)).sort(),['edit-plan.json','resolved-config.json']);
});

test('reviewed stage never reads lazy inputs or calls its operation before analysis passes',async()=>{
  const f=await fixture();let executions=0,inputReads=0;
  await assert.rejects(executeReviewedStage({config:f.config,runDir:f.runDir,stage:'render',inputs:async()=>{inputReads++;return {version:1};},execute:async()=>++executions}),/analysis_missing/);
  assert.equal(executions,0);assert.equal(inputReads,0);await assert.rejects(access(f.runDir),{code:'ENOENT'});
});

test('reviewed stage caps identical failures and preserves the original thrown error',async()=>{
  const f=await fixture();await f.save();let executions=0;const original=new Error('known_stage_failure: test fixture');
  const operation=()=>executeReviewedStage({config:f.config,runDir:f.runDir,stage:'render',inputs:{version:1},execute:async()=>{executions++;throw original;}});
  for(let i=0;i<2;i++)await assert.rejects(operation(),error=>error===original);
  await assert.rejects(operation(),/stage_failure_limit/);assert.equal(executions,2);
  const ledger=JSON.parse(await readFile(path.join(f.runDir,'logs','attempt-ledger.json'),'utf8'));
  assert.equal(ledger.attempts.length,2);assert.ok(ledger.attempts.every((a:any)=>a.status==='failed'));
});

test('successful reviewed revisions and cache returns remain repeatable',async()=>{
  const f=await fixture();await f.save();let executions=0;
  for(let i=0;i<6;i++){const result=await executeReviewedStage({config:f.config,runDir:f.runDir,stage:'capture',inputs:{version:1},execute:async()=>({cacheHit:true,iteration:++executions})});assert.equal(result.iteration,i+1);}
  const ledger=JSON.parse(await readFile(path.join(f.runDir,'logs','attempt-ledger.json'),'utf8'));
  assert.equal(ledger.attempts.length,6);assert.ok(ledger.attempts.every((a:any)=>a.status==='passed'));
});

test('stage failure ledger never derives identifiers from potentially sensitive error messages',async()=>{
  const f=await fixture();await f.save();const fakeSensitiveValue='fixturePrivateValueDoNotPersist';
  await assert.rejects(executeReviewedStage({config:f.config,runDir:f.runDir,stage:'render',inputs:{version:1},execute:async()=>{throw new Error('password='+fakeSensitiveValue);}}),new RegExp(fakeSensitiveValue));
  const saved=await readFile(path.join(f.runDir,'logs','attempt-ledger.json'),'utf8');
  assert.ok(!saved.includes(fakeSensitiveValue));
  const ledger=JSON.parse(saved);assert.equal(ledger.attempts[0].status,'failed');
});
