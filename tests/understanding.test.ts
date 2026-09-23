import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readSourceEvidence,createUnderstandingDraft,validateUnderstanding,assertUnderstanding,understandingConfigHash,beginStageAttempt,finishStageAttempt,isAllowedEvidencePath,type UnderstandingConfig,type UnderstandingManifest} from '../src/understanding.js';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
async function fixture(){
  const project=await mkdtemp(path.join(os.tmpdir(),'demo-understanding-'));await mkdir(path.join(project,'src'));
  await writeFile(path.join(project,'src','App.ts'),'export const ready = "dashboard";\nexport function createProject(name: string) { return {name, status: "created"}; }\n');
  await writeFile(path.join(project,'server.mjs'),'import http from "node:http";\nhttp.createServer((req,res)=>res.end("dashboard")).listen(4173,"127.0.0.1");\n');
  const config:UnderstandingConfig={url:'http://127.0.0.1:4173',allowedOrigins:['http://127.0.0.1:4173'],readyLocator:{testid:'dashboard'},start:{command:process.execPath,args:['server.mjs'],cwd:project},actions:[{type:'click',locator:{role:'button',name:'Создать проект'}},{type:'waitFor',locator:{testid:'created-project'}},{type:'screenshot',name:'result'}]};
  const result=await createUnderstandingDraft({project,config,sourceRequests:[{path:'src/App.ts',startLine:1,endLine:2},{path:'server.mjs',startLine:1,endLine:2}]});
  const manifest:UnderstandingManifest={...result.manifest,status:'ready',authoredBy:'Test author',product:{name:'Орбита',purpose:'Локальное приложение хранит демонстрационные проекты в общем обзоре.',audience:'Участники демонстрационной команды',primaryOutcome:'Новый именованный проект появляется в обзоре со статусом «Создан».'},safeStart:{...result.manifest.safeStart,explanation:'Сервер запускается на loopback через проверенный локальный файл server.mjs.',evidenceIds:['source-002']},flow:[{id:'create',summary:'Создать проект и дождаться появления его карточки в обзоре.',actionIndexes:[0,1],evidenceIds:['source-001'],success:{description:'Карточка созданного проекта видима после завершения обработки.',locator:{testid:'created-project'}}}]};
  const save=async(value=manifest)=>writeFile(path.join(project,'demo.understanding.json'),JSON.stringify(value,null,2));
  return {project,config,manifest,save,readings:result.readings};
}
test('draft exposes actual bounded line excerpts but cannot pass understanding gate',async()=>{
  const {project,config}=await fixture();const draft=await createUnderstandingDraft({project,config,sourceRequests:[{path:'src/App.ts',startLine:2,endLine:2}]});assert.match(draft.readings[0].content,/createProject/);assert.equal(draft.manifest.product.purpose,'');assert.equal(draft.manifest.sourceEvidence[0].startLine,2);await writeFile(path.join(project,'demo.understanding.json'),JSON.stringify(draft.manifest));const result=await validateUnderstanding({project,config});assert.equal(result.status,'blocked');assert.ok(result.issues.includes('analysis_is_draft'));
});
test('missing analysis blocks before capture and author-completed source evidence passes',async()=>{
  const f=await fixture();await assert.rejects(assertUnderstanding(f),/analysis_missing/);await f.save();const result=await assertUnderstanding(f);assert.equal(result.status,'passed');assert.equal(result.semanticUnderstandingVerified,false);assert.ok(result.analysisHash);
});
test('changing referenced source outside selected excerpt still makes analysis stale',async()=>{
  const f=await fixture();await f.save();await writeFile(path.join(f.project,'src','App.ts'),'export const ready = "dashboard";\nexport function createProject(name: string) { return {name, status: "created"}; }\nexport const destructive = true;\n');const result=await validateUnderstanding(f);assert.ok(result.issues.includes('source_stale:source-001'));
});
test('analysis accepts relative and absolute paths under a project alias while verifying the physical root',async()=>{
  const f=await fixture();await f.save();const parent=await mkdtemp(path.join(os.tmpdir(),'demo-project-alias-')),alias=path.join(parent,'project');
  await symlink(f.project,alias,process.platform==='win32'?'junction':'dir');
  for(const project of [f.project,alias])for(const manifestPath of [undefined,'demo.understanding.json',path.join(project,'demo.understanding.json'),path.join(f.project,'demo.understanding.json')]){
    const result=await validateUnderstanding({project,config:f.config,manifestPath});assert.equal(result.status,'passed',`${project} / ${manifestPath}: ${result.issues.join(', ')}`);
  }
});

test('project aliases do not permit lexical escapes or an outside manifest symlink',async()=>{
  const f=await fixture();await f.save();const parent=await mkdtemp(path.join(os.tmpdir(),'demo-manifest-alias-')),alias=path.join(parent,'project'),outside=path.join(parent,'outside');
  await mkdir(outside);await writeFile(path.join(outside,'review.json'),JSON.stringify(f.manifest));
  await symlink(f.project,alias,process.platform==='win32'?'junction':'dir');
  await symlink(outside,path.join(f.project,'linked-review'),process.platform==='win32'?'junction':'dir');
  for(const manifestPath of ['../outside/review.json',path.join(outside,'review.json'),'linked-review/review.json',path.join(alias,'linked-review','review.json')]){
    const result=await validateUnderstanding({project:alias,config:f.config,manifestPath});assert.equal(result.status,'blocked');assert.ok(result.issues.some(i=>i.includes('analysis_path_must_be_inside')||i==='analysis_realpath_outside_project'),result.issues.join(', '));
  }
});

test('capture-relevant config change invalidates analysis; voice and render changes do not',async()=>{
  const f=await fixture();await f.save();assert.equal(understandingConfigHash({...f.config,voice:'male',profile:'master-144',strictNativeFps:true,analysisFile:'other.json'} as any),understandingConfigHash(f.config));const config={...f.config,actions:[...f.config.actions,{type:'click',locator:{text:'Удалить всё'}}]};const result=await validateUnderstanding({...f,config});assert.ok(result.issues.includes('analysis_config_changed'));assert.ok(result.issues.includes('action_without_source_explanation:3'));
});
test('placeholder summaries and missing action evidence cannot masquerade as authored analysis',async()=>{
  const f=await fixture();f.manifest.product.purpose='TODO fill me with a description of the product';f.manifest.flow[0].evidenceIds=['invented'];await f.save();const result=await validateUnderstanding(f);assert.ok(result.issues.includes('product_purpose_requires_authored_explanation'));assert.ok(result.issues.includes('evidence_links_missing:create'));
});
test('known secret paths, synced sources, traversal and binary files are excluded before reading',async()=>{
  const f=await fixture();for(const name of ['.env','auth/profile.json','sources/reference.md','node_modules/pkg/index.js','../outside.ts','C:\\private.ts','src/private.key','demo.config.ts']){assert.equal(isAllowedEvidencePath(name),false,name);await assert.rejects(readSourceEvidence(f.project,[{path:name}]),/evidence_path_forbidden/);}
  const result=await validateUnderstanding({...f,manifestPath:'.env'});assert.equal(result.status,'blocked');assert.ok(result.issues.some(i=>i.includes('non_sensitive_json')));
});
test('symlink escapes are rejected using realpath, even with a safe-looking source filename',async()=>{
  const f=await fixture();const outside=await mkdtemp(path.join(os.tmpdir(),'demo-outside-'));await writeFile(path.join(outside,'outside.ts'),'export const external = true;');await symlink(outside,path.join(f.project,'linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(readSourceEvidence(f.project,[{path:'linked/outside.ts'}]),/outside_project/);
});
test('source evidence does not print common hardcoded key material',async()=>{
  const f=await fixture();await writeFile(path.join(f.project,'src','unsafe.ts'),'const api_key = "'+ 'x'.repeat(32)+'";');await assert.rejects(readSourceEvidence(f.project,[{path:'src/unsafe.ts'}]),/sensitive_pattern/);
});
test('URL-only mode requires fresh integrity-checked observed UI and says code is unavailable',async()=>{
  const f=await fixture();const config={...f.config,start:undefined};const now=new Date();const draft=await createUnderstandingDraft({project:f.project,config,mode:'url-only'});await mkdir(path.join(f.project,'observations'));
  const make=async(id:string,locator:any,observation:string)=>{const receipt={schemaVersion:1,kind:'product-demo-ui-observation',url:config.url,observedAt:now.toISOString(),locator,observation,visible:true};const raw=JSON.stringify(receipt);const file=`observations/${id}.json`;await writeFile(path.join(f.project,file),raw);return{id,url:config.url,observedAt:now.toISOString(),locator,observation,artifact:{path:file,sha256:hash(raw)}};};
  const ready=await make('ui-ready',{testid:'dashboard'},'На указанном сайте виден общий обзор проектов.');const result=await make('ui-result',{testid:'created-project'},'После согласованного демо-действия видна карточка нового проекта.');
  const manifest:UnderstandingManifest={...f.manifest,...draft.manifest,status:'ready',authoredBy:'Browser observing agent',product:f.manifest.product,codeUnavailableReason:'Исходный код удалённого веб-продукта недоступен в данном локальном проекте.',safeStart:{mode:'existing',explanation:'Используется уже открытый явно указанный сайт; локальный сервер не запускается.',evidenceIds:['ui-ready']},uiEvidence:[ready,result],flow:[{...f.manifest.flow[0],evidenceIds:['ui-result']}],limitations:['Семантика исходного кода не проверялась.']};await f.save(manifest);assert.equal((await validateUnderstanding({project:f.project,config,now})).status,'passed');await writeFile(path.join(f.project,result.artifact.path),'{}');assert.ok((await validateUnderstanding({project:f.project,config,now})).issues.includes('ui_evidence_invalid_or_stale:ui-result'));
});
test('URL-only drafts cannot certify source understanding or absent UI observations',async()=>{
  const f=await fixture();const config={...f.config,start:undefined};const draft=await createUnderstandingDraft({project:f.project,config,mode:'url-only'});assert.equal(draft.manifest.sourceEvidence.length,0);await f.save({...f.manifest,...draft.manifest,status:'ready'});const result=await validateUnderstanding({project:f.project,config});assert.ok(result.issues.includes('url_only_observed_ui_evidence_required'));assert.ok(result.issues.includes('code_unavailable_reason_required'));
});
test('previously valid UI observation expires after the configured time bound',async()=>{
  const f=await fixture();await mkdir(path.join(f.project,'observations'));
  const observedAt=new Date().toISOString(),locator={testid:'dashboard'},observation='The project dashboard is visible in the supplied local application.';
  const receipt={schemaVersion:1,kind:'product-demo-ui-observation',url:f.config.url,observedAt,locator,observation,visible:true};const raw=JSON.stringify(receipt);await writeFile(path.join(f.project,'observations','ready.json'),raw);
  f.manifest.uiEvidence=[{id:'ui-ready',url:f.config.url,observedAt,locator,observation,artifact:{path:'observations/ready.json',sha256:hash(raw)}}];await f.save();
  assert.equal((await validateUnderstanding({...f,now:new Date(observedAt)})).status,'passed');
  const result=await validateUnderstanding({...f,now:new Date(Date.parse(observedAt)+25*3_600_000)});assert.equal(result.status,'blocked');assert.ok(result.issues.includes('ui_evidence_invalid_or_stale:ui-ready'));
});

test('two failed identical stage inputs block third attempt; changing input has a total failure cap',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'demo-attempts-'));
  for(let i=0;i<2;i++){const a=await beginStageAttempt(dir,{stage:'render',inputHash:hash('v1')});await finishStageAttempt(dir,{attemptId:a.attemptId,status:'failed',failureCode:'decode_failed'});}await assert.rejects(beginStageAttempt(dir,{stage:'render',inputHash:hash('v1')}),/stage_failure_limit/);
  for(let i=0;i<2;i++){const a=await beginStageAttempt(dir,{stage:'render',inputHash:hash('v2')});await finishStageAttempt(dir,{attemptId:a.attemptId,status:'failed',failureCode:'decode_failed'});}await assert.rejects(beginStageAttempt(dir,{stage:'render',inputHash:hash('v3')}),/stage_total_failure_limit/);
});
test('successful cached or intentional reruns do not consume failure budget',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'demo-successes-'));for(let i=0;i<6;i++){const a=await beginStageAttempt(dir,{stage:'capture',inputHash:hash('same')});await finishStageAttempt(dir,{attemptId:a.attemptId,status:'passed'});}const ledger=JSON.parse(await readFile(path.join(dir,'logs','attempt-ledger.json'),'utf8'));assert.equal(ledger.attempts.filter((a:any)=>a.status==='passed').length,6);
});
test('parallel same-stage attempt is rejected and raw error text cannot enter ledger',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'demo-running-'));const a=await beginStageAttempt(dir,{stage:'render',inputHash:hash('v1')});await assert.rejects(beginStageAttempt(dir,{stage:'render',inputHash:hash('v2')}),/stage_attempt_in_progress/);await assert.rejects(finishStageAttempt(dir,{attemptId:a.attemptId,status:'failed',failureCode:'password=should-not-be-logged'}),/identifier/);await finishStageAttempt(dir,{attemptId:a.attemptId,status:'passed'});
});

 test('invalid authored understanding reports missing field paths without echoing input data',async()=>{
 const f=await fixture();const malformed:any=structuredClone(f.manifest);delete malformed.flow[0].id;await f.save(malformed);
 const result=await validateUnderstanding(f);assert.equal(result.status,'blocked');assert.ok(result.issues.includes('analysis_schema_invalid'));assert.ok(result.issues.includes('analysis_field:flow.0.id:invalid_type:expected-string'));assert.ok(!JSON.stringify(result.issues).includes(malformed.flow[0].summary));
});
