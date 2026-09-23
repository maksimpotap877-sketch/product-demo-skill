import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {planRun} from '../src/planning.js';
import {writeJson} from '../src/util.js';
import {makeExampleConfig} from '../src/discovery.js';
import {DemoConfigSchema,EditPlanSchema,type DemoConfig} from '../src/schema.js';

async function fixture(action:(dir:string,cfg:DemoConfig)=>Promise<void>){
 const dir=await mkdtemp(path.join(os.tmpdir(),'demo-editorial-'));
 try{
  const cfg=makeExampleConfig(dir);cfg.durationSec=8;
  cfg.storyboard={schemaVersion:1,title:'Test',scenes:[
   {sceneId:'open',meaning:'Open the form',visibleResult:'Form visible',displayText:'Open',spokenText:'Open',eventIds:['open-click'],sourceKind:'video',clipId:'clip',screenshotId:'modal',sourceStartMs:1000,sourceEndMs:1500,durationSec:4,layout:'product',camera:[{at:0,scale:1,x:.5,y:.5},{at:1,scale:1.1,x:.5,y:.5}]},
   {sceneId:'done',meaning:'Read result',visibleResult:'Saved',displayText:'Done',spokenText:'Done',eventIds:[],sourceKind:'screenshot',screenshotId:'result',durationSec:4,layout:'outro'}
  ]};
  await save(dir,cfg);
  await writeJson(path.join(dir,'capture/capture-manifest.json'),{schemaVersion:1,clips:[{id:'clip',path:'capture/clips/clip.webm',width:1600,height:900,fps:25,durationMs:20000,sourceStartMs:240,sourceEndMs:19000}],screenshots:[{id:'modal',path:'capture/screenshots/modal.png',width:2560,height:1440,sourceTimeMs:1500},{id:'result',path:'capture/screenshots/result.png',width:2560,height:1440,sourceTimeMs:3000}]});
  await writeFile(path.join(dir,'capture/events.jsonl'),[
   {eventId:'open-click',clipId:'clip',type:'click',actualActionMs:1250,x:800,y:450},
   {eventId:'unselected-click',clipId:'clip',type:'click',actualActionMs:1350,x:400,y:225},
   {eventId:'later-click',clipId:'clip',type:'click',actualActionMs:2500,x:400,y:225}
  ].map(e=>JSON.stringify(e)).join('\n')+'\n');
  await writeJson(path.join(dir,'narration/narration-manifest.json'),{schemaVersion:1,provider:'import',segments:[{sceneId:'open',path:'narration/open.wav',durationMs:2200},{sceneId:'done',path:'narration/done.wav',durationMs:2200}]});
  await action(dir,cfg);
 }finally{await rm(dir,{recursive:true,force:true});}
}
async function save(dir:string,cfg:DemoConfig){await writeJson(path.join(dir,'resolved-config.json'),cfg);await writeJson(path.join(dir,'storyboard.json'),cfg.storyboard);}

test('explicit scenes retain timing, selected events and actual asset dimensions without a substitute still',async()=>fixture(async dir=>{
 const plan=await planRun(dir,'web-60');
 assert.equal(plan.durationFrames,480);assert.equal(plan.transitionFrames,0);
 assert.equal(plan.scenes[0].holdPath,undefined);
 assert.deepEqual(plan.scenes[0].sourcePixels,{width:1600,height:900});
 assert.deepEqual(plan.scenes[1].sourcePixels,{width:2560,height:1440});
 assert.equal(plan.scenes[0].events.length,1);assert.equal(plan.scenes[0].events[0].frame,15);
 assert.deepEqual(plan.scenes[1].camera,[{frame:0,scale:1,x:.5,y:.5}]);
 assert.equal(plan.scenes[0].camera.at(-1)?.frame,239);
}));

test('an unnamed second scene remains its referenced screenshot instead of becoming the first clip',async()=>fixture(async(dir,cfg)=>{
 const scene=cfg.storyboard.scenes[0];scene.sourceKind='screenshot';delete scene.clipId;delete scene.sourceStartMs;delete scene.sourceEndMs;
 delete cfg.storyboard.scenes[1].sourceKind;
 await save(dir,cfg);const plan=await planRun(dir);
 assert.deepEqual(plan.scenes.map(s=>s.kind),['screenshot','screenshot']);
 assert.equal(plan.scenes[1].sourcePath,'capture/screenshots/result.png');
}));

test('missing explicit sources and ambiguous video selection fail instead of silently selecting another asset',async()=>fixture(async(dir,cfg)=>{
 const original=structuredClone(cfg);
 for(const change of [
  (c:DemoConfig)=>{c.storyboard.scenes[0].clipId='missing';},
  (c:DemoConfig)=>{delete c.storyboard.scenes[0].clipId;},
  (c:DemoConfig)=>{c.storyboard.scenes[1].screenshotId='missing';},
  (c:DemoConfig)=>{delete c.storyboard.scenes[1].screenshotId;}
 ]){const changed=structuredClone(original);change(changed);await save(dir,changed);await assert.rejects(planRun(dir),/clip ID not found|explicit clipId|screenshot ID not found/);}
}));

test('event selection rejects missing and out-of-range clicks; empty selection draws no cursor',async()=>fixture(async(dir,cfg)=>{
 cfg.storyboard.scenes[0].eventIds=['missing'];await save(dir,cfg);await assert.rejects(planRun(dir),/event ID not found/);
 cfg.storyboard.scenes[0].eventIds=['later-click'];await save(dir,cfg);await assert.rejects(planRun(dir),/outside the source range/);
 cfg.storyboard.scenes[0].eventIds=[];await save(dir,cfg);assert.deepEqual((await planRun(dir)).scenes[0].events,[]);
}));

test('planning refuses unallocated duration and explicit shots too short for their source or narration',async()=>fixture(async(dir,cfg)=>{
 cfg.durationSec=12;await save(dir,cfg);await assert.rejects(planRun(dir),/automatic padding is disabled/);
 cfg.durationSec=8;cfg.storyboard.scenes[0].durationSec=1;await save(dir,cfg);await assert.rejects(planRun(dir),/selected footage and narration need at least/);
 cfg.storyboard.scenes[0].durationSec=4;cfg.storyboard.scenes[0].sourceEndMs=8000;await save(dir,cfg);await assert.rejects(planRun(dir),/selected footage and narration need at least/);
 cfg.storyboard.scenes[0].sourceEndMs=21000;await save(dir,cfg);await assert.rejects(planRun(dir),/outside the selected clip/);
}));

test('camera cues that collapse onto the same output frame are rejected before render',async()=>fixture(async(dir,cfg)=>{
 cfg.storyboard.scenes[0].camera=[{at:0,scale:1,x:.5,y:.5},{at:.0001,scale:1.1,x:.5,y:.5}];
 await save(dir,cfg);await assert.rejects(planRun(dir),/collide after rounding/);
}));

test('direct edit plans reject unordered/out-of-scene camera keys, events and truncated video ranges',async()=>fixture(async dir=>{
 const plan=await planRun(dir);
 for(const camera of [
  [{frame:100,scale:1,x:.5,y:.5},{frame:50,scale:1.1,x:.5,y:.5}],
  [{frame:0,scale:1,x:.5,y:.5},{frame:0,scale:1.1,x:.5,y:.5}],
  [{frame:240,scale:1,x:.5,y:.5}]
 ])assert.equal(EditPlanSchema.safeParse({...plan,scenes:[{...plan.scenes[0],camera},plan.scenes[1]]}).success,false);
 assert.equal(EditPlanSchema.safeParse({...plan,scenes:[{...plan.scenes[0],events:[{...plan.scenes[0].events[0],frame:240}]},plan.scenes[1]]}).success,false);
 assert.equal(EditPlanSchema.safeParse({...plan,scenes:[{...plan.scenes[0],sourceEndMs:8000},plan.scenes[1]]}).success,false);
}));

test('camera timing rejects ambiguous normalized order and neural consent stays explicit',()=>{
 const cfg=makeExampleConfig(process.cwd());
 cfg.storyboard.scenes[0].camera=[{at:.7,scale:1,x:.5,y:.5},{at:.3,scale:1.5,x:.5,y:.5}];
 assert.equal(DemoConfigSchema.safeParse(cfg).success,false);
 delete cfg.storyboard.scenes[0].camera;
 assert.equal(DemoConfigSchema.parse(cfg).allowExternalTts,false);
 assert.equal(DemoConfigSchema.safeParse({...cfg,speechRatePercent:99}).success,false);
});

test('both initialized fixtures plan explicit action video from measured clip bounds without padding to thirty seconds',async()=>{
 for(const variant of ['basic','second'] as const){
  const dir=await mkdtemp(path.join(os.tmpdir(),'demo-initialized-plan-'));
  try{
   const cfg=makeExampleConfig(dir,variant);await save(dir,cfg);
   const sourceStartMs=321,sourceEndMs=variant==='basic'?8431.7:11247.2;
   await writeJson(path.join(dir,'capture/capture-manifest.json'),{schemaVersion:1,clips:[{id:'clip-001',path:'capture/clips/clip-001.webm',width:1600,height:900,fps:25,durationMs:sourceEndMs+400,sourceStartMs,sourceEndMs}],screenshots:cfg.storyboard.scenes.map(s=>({id:s.screenshotId,path:`capture/screenshots/${s.screenshotId}.png`,width:2560,height:1440}))});
   await writeFile(path.join(dir,'capture/events.jsonl'),cfg.storyboard.scenes[1].eventIds.map((eventId,i)=>JSON.stringify({eventId,clipId:'clip-001',type:'click',actualActionMs:1000+i*1000,x:800,y:450})).join('\n')+'\n');
   await writeJson(path.join(dir,'narration/narration-manifest.json'),{schemaVersion:1,provider:'fixture',segments:cfg.storyboard.scenes.map((s,i)=>({sceneId:s.sceneId,path:`narration/${s.sceneId}.wav`,durationMs:i===1?4300:2200}))});
   const plan=await planRun(dir);
   assert.equal(cfg.durationSec,3);assert.equal(cfg.storyboard.scenes[1].sourceStartMs,undefined);assert.equal(cfg.storyboard.scenes[1].sourceEndMs,undefined);
   assert.deepEqual(plan.scenes.map(s=>s.kind),['screenshot','video','screenshot']);
   assert.equal(plan.scenes[1].sourceStartMs,sourceStartMs);assert.equal(plan.scenes[1].sourceEndMs,sourceEndMs);
   assert.equal(plan.scenes[1].events.length,variant==='basic'?2:3);
   assert.equal(plan.scenes[0].outputDurationFrames,240);assert.equal(plan.scenes[2].outputDurationFrames,240);
   assert.ok(plan.durationFrames<30*60);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
