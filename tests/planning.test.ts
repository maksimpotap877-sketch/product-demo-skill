import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {planRun} from '../src/planning.js';
import {writeJson} from '../src/util.js';
import {makeExampleConfig} from '../src/discovery.js';
import {DemoConfigSchema} from '../src/schema.js';

test('trimmed editorial scenes preserve chosen hold image, mapped clicks and requested duration',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'demo-editorial-'));
 try{
  const cfg=makeExampleConfig(dir);
  cfg.durationSec=8;
  cfg.storyboard={schemaVersion:1,title:'Test',scenes:[
   {sceneId:'open',meaning:'',visibleResult:'',displayText:'Open',spokenText:'Open',eventIds:[],sourceKind:'video',clipId:'clip',screenshotId:'modal',sourceStartMs:1000,sourceEndMs:1500,durationSec:4,layout:'product',camera:[{at:0,scale:1,x:.5,y:.5},{at:1,scale:1.5,x:.5,y:.5}]},
   {sceneId:'done',meaning:'',visibleResult:'',displayText:'Done',spokenText:'Done',eventIds:[],sourceKind:'screenshot',screenshotId:'result',durationSec:4,layout:'outro'}
  ]};
  await writeJson(path.join(dir,'resolved-config.json'),cfg);
  await writeJson(path.join(dir,'storyboard.json'),cfg.storyboard);
  await writeJson(path.join(dir,'capture/capture-manifest.json'),{schemaVersion:1,clips:[{id:'clip',path:'capture/clips/clip.webm',width:1600,height:900,fps:25,durationMs:20000,sourceStartMs:240,sourceEndMs:19000}],screenshots:[{id:'modal',path:'capture/screenshots/modal.png',width:2560,height:1440,sourceTimeMs:1500},{id:'result',path:'capture/screenshots/result.png',width:2560,height:1440,sourceTimeMs:3000}]});
  const {writeFile}=await import('node:fs/promises');
  await writeFile(path.join(dir,'capture/events.jsonl'),JSON.stringify({clipId:'clip',type:'click',actualActionMs:1250,x:800,y:450})+'\n');
  await writeJson(path.join(dir,'narration/narration-manifest.json'),{schemaVersion:1,provider:'import',segments:[{sceneId:'open',path:'narration/open.wav',durationMs:2200},{sceneId:'done',path:'narration/done.wav',durationMs:2200}]});
  const plan=await planRun(dir,'web-60');
  assert.equal(plan.durationFrames,480);
  assert.equal(plan.scenes[0].holdPath,'capture/screenshots/modal.png');
  assert.equal(plan.scenes[0].events[0].frame,15);
  assert.equal(plan.scenes[1].kind,'screenshot');
  assert.equal(plan.presentation,'cinematic');
  assert.equal(plan.scenes[0].camera.at(-1)?.frame,plan.scenes[0].outputDurationFrames-1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('camera timing rejects ambiguous keyframe order and neural consent is explicit',()=>{
 const cfg=makeExampleConfig(process.cwd());
 cfg.storyboard.scenes[0].camera=[{at:.7,scale:1,x:.5,y:.5},{at:.3,scale:1.5,x:.5,y:.5}];
 assert.equal(DemoConfigSchema.safeParse(cfg).success,false);
 delete cfg.storyboard.scenes[0].camera;
 assert.equal(DemoConfigSchema.parse(cfg).allowExternalTts,false);
 assert.equal(DemoConfigSchema.safeParse({...cfg,speechRatePercent:99}).success,false);
});
