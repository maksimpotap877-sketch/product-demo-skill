#!/usr/bin/env node
import {Command} from 'commander';
import path from 'node:path';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {DemoConfigSchema, StoryboardSchema, type DemoConfig} from './schema.js';
import {readJson,writeJson,hash,contained,VERSION,log} from './util.js';
import {doctor,setup} from './doctor.js';
import {discoverProject,makeExampleConfig,installExampleSite} from './discovery.js';
import {capture,benchmark,auth} from './capture.js';
import {voicesPreview,narrate,readPreferences} from './narration.js';
import {planRun} from './planning.js';
import {renderRun} from './rendering.js';
import {inspectRun} from './qa.js';
import {createReviewDraft,importEditorialReview} from './editorial-review.js';
import {proofRun} from './proof.js';
import {previewRun} from './preview.js';
import {installSkill,skillStatus,uninstallSkill} from './install.js';
import {createUnderstandingDraft,validateUnderstanding,assertUnderstanding} from './understanding.js';
const cli=new Command().name('demo-video').version(VERSION).description('Реальные демо веб-продуктов: capture, voice, edit, render, QA');
const common=(c:Command)=>c.option('--project <path>','Trusted local project root').option('--config <path>','Trusted local JSON or TypeScript config').option('--analysis <path>','Project understanding manifest, default demo.understanding.json').option('--output <path>','Output root').option('--run <path>','Existing run directory').option('--profile <name>','Render profile').option('--duration <seconds>','Minimum requested seconds',Number).option('--voice <gender>','female or male').option('--voice-id <id>','Verified installed voice').option('--no-save-voice-preference','Do not change the saved voice preference').option('--language <language>','ru-RU').option('--tts-provider <provider>','auto, edge-neural, or explicit offline windows-sapi').option('--allow-external-tts','Authorize sending narration text to the free online speech service').option('--speech-rate <percent>','Neural speech rate adjustment from -10 to 10',Number).option('--narration-file <path>','Import WAV or MP3').option('--strict-native-fps','Fail native gate without downgrading silently').option('--dry-run','Report actions without writing or synthesis').option('--json','JSON only stdout');
function emit(v:any,o:any){if(o.json)process.stdout.write(JSON.stringify(v)+'\n');else process.stdout.write(JSON.stringify(v,null,2)+'\n');}
async function loadConfig(o:any):Promise<DemoConfig>{const project=path.resolve(o.project??process.cwd());let p=path.resolve(project,o.config??'demo.config.json');try{await access(p);}catch{if(o.config)throw new Error('Config not found: '+p);p=path.join(project,'demo.config.ts');await access(p);}contained(project,path.relative(project,p));const raw=p.endsWith('.ts')?(await tsImport(pathToFileURL(p).href,import.meta.url)).default:await readJson(p);const overrides:any={project};if(raw.voice===undefined&&o.voice===undefined){const prefs=await readPreferences();if(prefs.voice)overrides.voice=prefs.voice;}for(const [flag,field] of [['analysis','analysisFile'],['profile','profile'],['duration','durationSec'],['voice','voice'],['voiceId','voiceId'],['language','language'],['ttsProvider','ttsProvider'],['allowExternalTts','allowExternalTts'],['speechRate','speechRatePercent'],['strictNativeFps','strictNativeFps']])if(o[flag]!==undefined)overrides[field]=o[flag];return DemoConfigSchema.parse({...raw,...overrides});}
function runDir(o:any){if(!o.run)throw new Error('--run requires existing run directory');return path.resolve(o.project??process.cwd(),o.run);}
async function prepare(o:any){const cfg=await loadConfig(o);await assertUnderstanding({project:cfg.project!,config:cfg,manifestPath:cfg.analysisFile});const output=path.resolve(o.output??path.join(cfg.project!,'output'));const identity=hash({url:cfg.url,actions:cfg.actions,viewport:cfg.viewportCss,pixels:cfg.capturePixels}).slice(0,12);const dir=o.run?runDir(o):path.join(output,'run-'+identity);await mkdir(dir,{recursive:true});await writeJson(path.join(dir,'resolved-config.json'),cfg);await writeJson(path.join(dir,'storyboard.json'),cfg.storyboard);await writeFile(path.join(dir,'script.ru.md'),cfg.storyboard.scenes.map(s=>`## ${s.displayText}\n\n${s.spokenText}`).join('\n\n'));return {cfg,dir};}
async function checkpoint(dir:string,stage:string,status:string,error?:string){await writeJson(path.join(dir,'checkpoint.json'),{schemaVersion:1,stage,status,error,updatedAt:new Date().toISOString(),resume:`demo-video resume --run "${dir}"`});}
async function pipeline(o:any,resumed?:{cfg:DemoConfig;dir:string;startStage:string}){
 const stages=['capture','narrate','plan','render','inspect'];
 if(o.dryRun){emit({status:'planned',config:resumed?.cfg??await loadConfig(o),steps:resumed?stages.slice(Math.max(0,stages.indexOf(resumed.startStage))):stages,externalRequests:0},o);return;}
 if(resumed)await assertUnderstanding({project:resumed.cfg.project||process.cwd(),config:resumed.cfg,manifestPath:resumed.cfg.analysisFile});
 const {cfg,dir}=resumed??await prepare(o);let stage=resumed?.startStage??'capture';let rendered:any;
 try{
  const startIndex=Math.max(0,stages.indexOf(stage));
  for(const next of stages.slice(startIndex)){
   stage=next;await checkpoint(dir,stage,'running');
   if(stage==='capture')await capture({...cfg,strictNativeFps:false},dir);
   if(stage==='narrate')await narrate(dir,{voice:cfg.voice,voiceId:cfg.voiceId,language:cfg.language,provider:cfg.ttsProvider,allowExternalTts:cfg.allowExternalTts,speechRatePercent:cfg.speechRatePercent,narrationFile:o.narrationFile,savePreference:o.saveVoicePreference});
   if(stage==='plan')await planRun(dir,cfg.profile);
   if(stage==='render')rendered=await renderRun(dir,cfg.profile);
  }
  const report=await inspectRun(dir,cfg.profile);await checkpoint(dir,report.deliveryStatus==='reviewed'?'complete':'review',report.deliveryStatus??'review-candidate');
  emit({run:dir,render:rendered??await readJson(path.join(dir,`renders/render-${cfg.profile}.json`)),quality:report.status,deliveryStatus:report.deliveryStatus},o);
  if(cfg.strictNativeFps){await checkpoint(dir,'native144','blocked','Hybrid artifact saved; native144 capture gate not passed.');process.exitCode=3;}
  else if(report.status==='failed')process.exitCode=1;
 }catch(e){await checkpoint(dir,stage,'failed',e instanceof Error?e.message:String(e));throw e;}
}
common(cli.command('doctor')).action(async o=>{if(o.dryRun)return emit({action:'doctor'},o);emit(await doctor(o.output),o)});
common(cli.command('setup')).action(async o=>{if(o.dryRun)return emit({action:'setup',installMissingBrowser:true},o);emit(await setup(o.output),o)});
common(cli.command('discover')).action(async o=>emit(await discoverProject(o.project??process.cwd()),o));
common(cli.command('init')).option('--example <name>','basic or second','basic').action(async o=>{const project=path.resolve(o.project??process.cwd());if(!['basic','second'].includes(o.example))throw new Error('Unknown example');const cfg=DemoConfigSchema.parse({...makeExampleConfig(project,o.example,o.example==='second'?4174:4173,true),voice:o.voice??(await readPreferences()).voice??'female'});const file=path.join(project,'demo.config.json');if(o.dryRun)return emit({file,config:cfg},o);await mkdir(project,{recursive:true});try{await access(file);throw new Error('Config exists; edit it or choose another project');}catch(e:any){if(e.code!=='ENOENT')throw e;}await installExampleSite(project,o.example);await writeJson(file,cfg);emit({file,next:'Read the example source files and run analyze before capture.'},o);});
common(cli.command('analyze'))
 .option('--source <path>','Source path; repeat to include more files',(value:string,previous:string[])=>[...previous,value],[])
 .option('--source-range <path:start:end>','Explicit inclusive line range; repeat as needed',(value:string,previous:string[])=>[...previous,value],[])
 .option('--mode <mode>','code or explicit url-only exception','code')
 .option('--validate','Validate existing manifest without generating one')
 .action(async o=>{
  const config=await loadConfig(o),project=config.project!,manifestPath=path.resolve(project,o.analysis??config.analysisFile??'demo.understanding.json');
  contained(project,path.relative(project,manifestPath));
  if(o.validate){const report=await validateUnderstanding({project,config,manifestPath});emit(report,o);if(report.status!=='passed')process.exitCode=3;return;}
  if(!['code','url-only'].includes(o.mode))throw new Error('Invalid analysis mode');
  const result=await createUnderstandingDraft({project,config,mode:o.mode,sourceRequests:[...o.source.map((p:string)=>({path:p})),...o.sourceRange.map((spec:string)=>{const m=/^(.+):(\d+):(\d+)$/.exec(spec);if(!m)throw new Error('Source range must be path:start:end');return {path:m[1],startLine:Number(m[2]),endLine:Number(m[3])};})]});
  if(!o.dryRun){try{await access(manifestPath);throw new Error('Analysis exists; review and edit it without overwriting prior reasoning.');}catch(e:any){if(e.code!=='ENOENT')throw e;}await writeJson(manifestPath,result.manifest);}
  emit({...result,file:manifestPath,next:'Read readings, author product/flow/safeStart, set status ready, then analyze --validate. Drafts cannot record.'},o);
 });
common(cli.command('benchmark')).option('--target-fps <fps>','Native target',Number,144).action(async o=>{if(o.dryRun)return emit({action:'benchmark',targetFps:o.targetFps},o);const result=await benchmark({outputDir:path.resolve(o.output??'output/benchmark'),targetFps:o.targetFps});emit(result,o);if(o.strictNativeFps&&result.status!=='passed')process.exitCode=3;});
common(cli.command('auth')).option('--mode <mode>','login/status/reset','login').option('--local-test','Automatic local fixture only').action(async o=>{const cfg=await loadConfig(o);if(o.dryRun)return emit({action:'auth',mode:o.mode,recording:false},o);emit(await auth(cfg,{mode:o.mode,localTest:!!o.localTest}),o);});
common(cli.command('capture')).action(async o=>{if(o.dryRun)return emit({action:'capture',config:await loadConfig(o)},o);const {cfg,dir}=await prepare(o);emit({run:dir,manifest:await capture(cfg,dir)},o);});
const voices=cli.command('voices');common(voices.command('preview')).action(async o=>{if(o.dryRun)return emit({provider:o.ttsProvider??'auto',externalRequests:0,amount:0,wouldSendNarrationText:o.ttsProvider!=='windows-sapi'&&!!o.allowExternalTts},o);emit(await voicesPreview(path.resolve(o.output??'output/voice-samples'),{language:o.language,provider:o.ttsProvider,allowExternalTts:o.allowExternalTts,speechRatePercent:o.speechRate,voice:o.voice}),o);});
common(cli.command('narrate')).action(async o=>{if(o.dryRun)return emit({action:'narrate',externalRequests:0,amount:0},o);const dir=runDir(o);let saved:Partial<DemoConfig>={};try{saved=DemoConfigSchema.parse(await readJson(path.join(dir,'resolved-config.json')));}catch(e:any){if(e.code!=='ENOENT')throw e;}emit(await narrate(dir,{voice:o.voice??saved.voice,voiceId:o.voiceId??saved.voiceId,language:o.language??saved.language,provider:o.ttsProvider??saved.ttsProvider,allowExternalTts:o.allowExternalTts??saved.allowExternalTts,speechRatePercent:o.speechRate??saved.speechRatePercent,narrationFile:o.narrationFile,savePreference:o.saveVoicePreference}),o);});
common(cli.command('plan')).action(async o=>{if(o.dryRun)return emit({action:'plan'},o);emit(await planRun(runDir(o),o.profile),o);});
common(cli.command('render')).action(async o=>{if(o.dryRun)return emit({action:'render'},o);emit(await renderRun(runDir(o),o.profile,o.analysis),o);});
common(cli.command('proof')).option('--scene <id>','Representative scene ID; repeat for up to four scenes',(id:string,ids:string[])=>[...ids,id],[]).action(async o=>{if(o.dryRun)return emit({action:'proof',scenes:o.scene},o);emit(await proofRun(runDir(o),o.profile,o.scene),o);});
common(cli.command('inspect')).action(async o=>{if(o.dryRun)return emit({action:'inspect'},o);const report=await inspectRun(runDir(o),o.profile);emit(report,o);if(report.status==='failed')process.exitCode=1;});
common(cli.command('review')).option('--init','Create an unapproved editorial review draft for this exact export').option('--file <path>','Import reviewer evidence JSON for this exact export').action(async o=>{if(!!o.init===!!o.file)throw new Error('Choose exactly one: review --init or review --file <path>.');if(o.dryRun)return emit({action:'review',mode:o.init?'draft':'import'},o);emit(o.init?await createReviewDraft(runDir(o),o.profile):await importEditorialReview(runDir(o),path.resolve(o.file),o.profile),o);});
common(cli.command('preview')).option('--port <port>','Loopback port',Number,0).action(async o=>{if(o.dryRun)return emit({action:'preview',host:'127.0.0.1'},o);const p=await previewRun(runDir(o),o.port,o.profile);emit({url:p.url,run:runDir(o)},o);process.on('SIGINT',()=>p.server.close());});
common(cli.command('all')).action(async o=>pipeline(o));
common(cli.command('resume')).action(async o=>{
 const dir=runDir(o);const saved=await readJson(path.join(dir,'resolved-config.json'));
 const overrides:any={};for(const [flag,field] of [['analysis','analysisFile'],['profile','profile'],['duration','durationSec'],['voice','voice'],['voiceId','voiceId'],['language','language'],['ttsProvider','ttsProvider'],['allowExternalTts','allowExternalTts'],['speechRate','speechRatePercent'],['strictNativeFps','strictNativeFps']])if(o[flag]!==undefined)overrides[field]=o[flag];
 // A saved JSON run may be outside its original project. It is data, never imported as executable config.
 const cfg=DemoConfigSchema.parse({...saved,...overrides});const storyboardText=await readFile(path.join(dir,'storyboard.json'),'utf8');StoryboardSchema.parse(JSON.parse(storyboardText));
 let startStage='capture';try{const prior=await readJson(path.join(dir,'checkpoint.json'));startStage=['capture','narrate','plan','render','inspect'].includes(prior.stage)?prior.stage:'inspect';}catch{}
 const voiceChanged=['voice','voiceId','language','ttsProvider','allowExternalTts','speechRate','narrationFile'].some(flag=>o[flag]!==undefined);
 const planChanged=['profile','duration'].some(flag=>o[flag]!==undefined);
 let storyChanged=false;try{storyChanged=(await readJson(path.join(dir,'narration/narration-manifest.json'))).sourceHash!==hash(storyboardText);}catch{}
 const rank=['capture','narrate','plan','render','inspect'];
 if((voiceChanged||storyChanged)&&rank.indexOf(startStage)>1)startStage='narrate';
 else if(planChanged&&rank.indexOf(startStage)>2)startStage='plan';
 if(!o.dryRun)await writeJson(path.join(dir,'resolved-config.json'),cfg);
 await pipeline(o,{cfg,dir,startStage});
});
const skill=cli.command('skill');for(const action of ['install','status','uninstall'])common(skill.command(action)).option('--scope <scope>','user or project','user').option('--client <client>','codex, claude, or both','codex').action(async o=>{if(!['user','project'].includes(o.scope))throw new Error('Invalid scope');if(o.dryRun)return emit({action:'skill '+action,scope:o.scope,client:o.client},o);emit(await (action==='install'?installSkill:action==='uninstall'?uninstallSkill:skillStatus)({scope:o.scope,project:o.project,client:o.client}),o);});
cli.parseAsync().catch(error=>{const json=process.argv.includes('--json');if(json)process.stdout.write(JSON.stringify({status:'failed',error:error instanceof Error?error.message:String(error)})+'\n');else log(error instanceof Error?error.message:String(error));process.exitCode=/strict_native_fps|human_auth_required|understanding_blocked|stage_failure_limit|stage_total_failure_limit|stage_attempt_in_progress/.test(error instanceof Error?error.message:String(error))?3:1;});
