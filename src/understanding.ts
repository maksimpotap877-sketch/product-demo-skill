import {z} from 'zod';
import {access,mkdir,open,readFile,realpath,rename,stat,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {LocatorSchema} from './schema.js';

const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const canonical=(value:any):string=>JSON.stringify(sort(value));
function sort(value:any):any{return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,sort(value[k])])):value;}
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const date=z.string().datetime({offset:true});
export interface UnderstandingConfig {url:string;allowedOrigins?:string[];start?:{command:string;args:string[];cwd?:string;timeoutMs?:number};readyLocator?:z.infer<typeof LocatorSchema>;auth?:{required?:boolean;expectedLocator?:z.infer<typeof LocatorSchema>};actions:{type:string;locator?:unknown;value?:string;[key:string]:unknown}[]}
export interface SourceRequest {path:string;startLine?:number;endLine?:number}
export const SourceEvidenceSchema=z.object({id,path:z.string().min(1).max(500),startLine:z.number().int().positive(),endLine:z.number().int().positive(),fileSha256:sha,excerptSha256:sha}).strict();
export const UiEvidenceSchema=z.object({id,url:z.string().url(),observedAt:date,locator:LocatorSchema,observation:z.string().max(1500),artifact:z.object({path:z.string().min(1).max(500),sha256:sha}).strict()}).strict();
export const UnderstandingManifestSchema=z.object({
  schemaVersion:z.literal(1),status:z.enum(['draft','ready']),mode:z.enum(['code','url-only']),authoredBy:z.string().max(100),reviewedAt:date,
  binding:z.object({configSha256:sha}).strict(),
  product:z.object({name:z.string().max(120),purpose:z.string().max(1500),audience:z.string().max(500),primaryOutcome:z.string().max(1000)}).strict(),
  safeStart:z.object({mode:z.enum(['managed','existing']),command:z.string().max(1000).optional(),args:z.array(z.string().max(2000)).max(50).optional(),cwd:z.string().max(1000).optional(),explanation:z.string().max(1500),evidenceIds:z.array(id).max(20)}).strict(),
  flow:z.array(z.object({id,summary:z.string().max(1200),actionIndexes:z.array(z.number().int().nonnegative()).max(100),evidenceIds:z.array(id).max(20),success:z.object({description:z.string().max(1200),locator:LocatorSchema}).strict()}).strict()).max(40),
  sourceEvidence:z.array(SourceEvidenceSchema).max(30),uiEvidence:z.array(UiEvidenceSchema).max(30),codeUnavailableReason:z.string().max(1500).optional(),limitations:z.array(z.string().max(1000)).max(30)
}).strict();
export type UnderstandingManifest=z.infer<typeof UnderstandingManifestSchema>;

const blockedDirectories=new Set(['sources','node_modules','auth','.auth','.git','.ssh','.aws','.azure','.codex','.agents','.next','dist','build','coverage']);
const blockedName=/(?:^|[._-])(?:secrets?|credentials?|passwords?|cookies?|storage[-_]?state|tokens?)(?:[._-]|$)/i;
const sourceExtensions=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.mts','.cts','.html','.htm','.css','.scss','.vue','.svelte','.py','.go','.rs','.java','.cs','.rb','.php','.md','.yaml','.yml','.toml']);
const codeExtensions=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.mts','.cts','.html','.htm','.vue','.svelte','.py','.go','.rs','.java','.cs','.rb','.php']);
const knownJson=new Set(['package.json','package-lock.json','tsconfig.json','jsconfig.json','deno.json','deno.jsonc']);
const maxSourceBytes=2_000_000,maxExcerptBytes=65_536;

/** A conservative path policy, not an assertion that arbitrary source is secret-free. */
export function isAllowedEvidencePath(relative:string,kind:'source'|'ui'='source'){
  if(!relative||relative.includes('\0')||relative.includes(':')||path.isAbsolute(relative)||path.win32.isAbsolute(relative))return false;
  const parts=relative.replaceAll('\\','/').split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||blockedDirectories.has(p.toLowerCase())||p.toLowerCase().startsWith('.env')||blockedName.test(p)))return false;
  const base=parts.at(-1)!.toLowerCase(),ext=path.extname(base);
  if(kind==='ui')return ext==='.json';
  if(parts.some(p=>['output','outputs','logs'].includes(p.toLowerCase()))||base==='demo.understanding.json'||base.startsWith('demo.config.'))return false;
  return sourceExtensions.has(ext)||knownJson.has(base);
}
function noSensitivePatterns(text:string){
  if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b|(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"'\r\n]{20,}["']/i.test(text))throw new Error('sensitive_pattern_in_evidence');
}
function relativeInside(root:string,file:string){const rel=path.relative(root,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
async function checkedFile(project:string,relative:string,kind:'source'|'ui'){
  if(!isAllowedEvidencePath(relative,kind))throw new Error('evidence_path_forbidden');
  const root=await realpath(project),file=await realpath(path.resolve(root,relative));
  if(!relativeInside(root,file)||!isAllowedEvidencePath(path.relative(root,file),kind))throw new Error('evidence_realpath_outside_project_or_forbidden');
  const s=await stat(file);if(!s.isFile()||s.size>maxSourceBytes)throw new Error('evidence_file_too_large_or_not_regular');
  return {file,size:s.size};
}
async function readEvidenceRange(project:string,request:SourceRequest){
  const checked=await checkedFile(project,request.path,'source');const data=await readFile(checked.file);const content=data.toString('utf8');if(content.includes('\0'))throw new Error('binary_source_not_supported');noSensitivePatterns(content);
  const lines=content.replaceAll('\r\n','\n').split('\n');const start=request.startLine??1,end=request.endLine??Math.min(lines.length,300);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>lines.length||end-start+1>500)throw new Error('source_line_range_invalid_or_too_large');
  const excerpt=lines.slice(start-1,end).join('\n');if(Buffer.byteLength(excerpt)>maxExcerptBytes)throw new Error('source_excerpt_too_large_select_narrower_lines');
  return {path:request.path.replaceAll('\\','/'),startLine:start,endLine:end,fileSha256:digest(data),excerptSha256:digest(excerpt),content:excerpt,fileBytes:checked.size,totalLines:lines.length};
}
export async function readSourceEvidence(project:string,requests:SourceRequest[]){
  if(requests.length>30)throw new Error('too_many_source_requests');
  const evidence:z.infer<typeof SourceEvidenceSchema>[]=[],readings:{evidenceId:string;path:string;startLine:number;endLine:number;totalLines:number;content:string}[]=[];let totalBytes=0,totalExcerptBytes=0;
  for(const [index,request] of requests.entries()){
    const result=await readEvidenceRange(project,request);totalBytes+=result.fileBytes;totalExcerptBytes+=Buffer.byteLength(result.content);if(totalBytes>10_000_000||totalExcerptBytes>300_000)throw new Error('source_read_budget_exceeded');
    const evidenceId=`source-${String(index+1).padStart(3,'0')}`;evidence.push({id:evidenceId,path:result.path,startLine:result.startLine,endLine:result.endLine,fileSha256:result.fileSha256,excerptSha256:result.excerptSha256});readings.push({evidenceId,path:result.path,startLine:result.startLine,endLine:result.endLine,totalLines:result.totalLines,content:result.content});
  }
  return {evidence,readings,limits:{maxFiles:30,maxFileBytes:maxSourceBytes,maxExcerptBytes,totalReadBytes:totalBytes,totalExcerptBytes}};
}
function validateUrl(value:string){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||[...u.searchParams.keys()].some(k=>/token|secret|password|api.?key|authorization/i.test(k))||/token|secret|password|api.?key|authorization/i.test(decodeURIComponent(u.hash)))throw new Error('understanding_url_invalid_or_sensitive');return u;}
function validateConfigBoundary(config:UnderstandingConfig){
  validateUrl(config.url);for(const o of config.allowedOrigins||[]){const u=validateUrl(o);if(o!==u.origin)throw new Error('understanding_allowed_origin_invalid');}
  if(config.start){noSensitivePatterns(canonical(config.start));if(config.start.args.some(a=>/^--?(?:password|token|secret|api[-_]?key)(?:=|$)/i.test(a)))throw new Error('sensitive_start_arguments_forbidden');if(/^(?:cmd|powershell|pwsh|bash|sh|wscript|cscript)(?:\.exe)?$/i.test(path.basename(config.start.command)))throw new Error('safe_start_requires_direct_executable_and_argv');}
}
export function understandingConfigHash(config:UnderstandingConfig){validateConfigBoundary(config);return digest(canonical({url:config.url,allowedOrigins:[...(config.allowedOrigins||[])].sort(),start:config.start,readyLocator:config.readyLocator,auth:config.auth,actions:config.actions}));}
export async function createUnderstandingDraft(options:{project:string;config:UnderstandingConfig;sourceRequests?:SourceRequest[];mode?:'code'|'url-only'}){
  const binding={configSha256:understandingConfigHash(options.config)};const result=await readSourceEvidence(options.project,options.sourceRequests||[]);const mode=options.mode||'code';
  if(mode==='url-only'&&result.evidence.length)throw new Error('url_only_must_not_claim_source_reading');
  const s=options.config.start;
  const manifest:UnderstandingManifest={schemaVersion:1,status:'draft',mode,authoredBy:'',reviewedAt:new Date().toISOString(),binding,product:{name:'',purpose:'',audience:'',primaryOutcome:''},safeStart:{mode:s?'managed':'existing',...(s?{command:s.command,args:s.args,cwd:s.cwd}:{}),explanation:'',evidenceIds:[]},flow:[],sourceEvidence:result.evidence,uiEvidence:[],...(mode==='url-only'?{codeUnavailableReason:''}:{}),limitations:[]};
  return {manifest,readings:result.readings,limits:result.limits,notice:'Agent must read the provided source, author the product/flow explanation and evidence links, then mark ready. Structural validation does not prove semantic understanding.'};
}
const placeholders=/\b(?:todo|tbd|placeholder|lorem ipsum|fill me|replace me|example summary)\b|заполните|описание здесь|указать позже|текст заглушк/i;
function meaningful(value:string,minLength:number){return value.trim().length>=minLength&&!placeholders.test(value)&&new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).size>=2;}
export class UnderstandingBlockedError extends Error {readonly code='understanding_blocked';readonly status='blocked';constructor(public readonly issues:string[]){super('understanding_blocked: '+issues.join('; '));}}
export interface UnderstandingResult {status:'passed'|'blocked';issues:string[];analysisHash?:string;manifest?:UnderstandingManifest;semanticUnderstandingVerified:false;manifestPath:string}
export async function validateUnderstanding(options:{project:string;config:UnderstandingConfig;manifestPath?:string;now?:Date;maxUiAgeHours?:number}):Promise<UnderstandingResult>{
  const requestedProject=path.resolve(options.project),project=await realpath(requestedProject);
  const manifestPath=path.resolve(requestedProject,options.manifestPath||'demo.understanding.json');const fail=(issues:string[]):UnderstandingResult=>({status:'blocked',issues,semanticUnderstandingVerified:false,manifestPath});
  // Windows package aliases and project junctions may have different lexical and
  // physical roots. Accept either spelling, then verify the actual file below.
  const lexicalRoot=relativeInside(requestedProject,manifestPath)?requestedProject:project;
  if(!relativeInside(lexicalRoot,manifestPath)||!isAllowedEvidencePath(path.relative(lexicalRoot,manifestPath),'ui'))return fail(['analysis_path_must_be_inside_project_and_non_sensitive_json']);
  let raw:string,manifest:UnderstandingManifest;
  try{const actual=await realpath(manifestPath);if(!relativeInside(project,actual)||!isAllowedEvidencePath(path.relative(project,actual),'ui'))return fail(['analysis_realpath_outside_project']);const s=await stat(actual);if(!s.isFile()||s.size>1_000_000)return fail(['analysis_file_invalid_or_too_large']);raw=await readFile(actual,'utf8');noSensitivePatterns(raw);manifest=UnderstandingManifestSchema.parse(JSON.parse(raw));}
  catch(e:any){if(e?.code==='ENOENT')return fail(['analysis_missing']);if(e instanceof z.ZodError)return fail(['analysis_schema_invalid',...e.issues.slice(0,12).map(i=>`analysis_field:${i.path.map(String).join('.')||'<root>'}:${i.code}${i.code==='invalid_type'?':expected-'+i.expected:''}`)]);return fail([e?.message==='sensitive_pattern_in_evidence'?'sensitive_pattern_in_analysis':'analysis_schema_invalid']);}
  const issues:string[]=[];const now=(options.now||new Date()).getTime();
  if(manifest.status!=='ready')issues.push('analysis_is_draft');
  if(manifest.authoredBy.trim().length<2||placeholders.test(manifest.authoredBy))issues.push('analysis_author_missing');
  if(Date.parse(manifest.reviewedAt)>now+300_000)issues.push('review_timestamp_in_future');
  try{if(manifest.binding.configSha256!==understandingConfigHash(options.config))issues.push('analysis_config_changed');}catch{issues.push('config_boundary_invalid');}
  if(!options.config.readyLocator)issues.push('ready_locator_required');
  if(manifest.product.name.trim().length<2||placeholders.test(manifest.product.name))issues.push('product_name_missing');
  for(const [field,min] of [['purpose',20],['audience',8],['primaryOutcome',16]] as const)if(!meaningful(manifest.product[field],min))issues.push(`product_${field}_requires_authored_explanation`);
  if(!meaningful(manifest.safeStart.explanation,16))issues.push('safe_start_explanation_missing');
  const expectedStart=options.config.start?{mode:'managed',command:options.config.start.command,args:options.config.start.args,cwd:options.config.start.cwd}:{mode:'existing'};
  const suppliedStart={mode:manifest.safeStart.mode,command:manifest.safeStart.command,args:manifest.safeStart.args,cwd:manifest.safeStart.cwd};
  if(canonical(expectedStart)!==canonical(suppliedStart))issues.push('safe_start_does_not_match_config');
  const evidenceIds=new Set<string>();
  for(const e of [...manifest.sourceEvidence,...manifest.uiEvidence]){if(evidenceIds.has(e.id))issues.push('duplicate_evidence_id');evidenceIds.add(e.id);}
  if(manifest.mode==='code'){
    if(!manifest.sourceEvidence.length)issues.push('code_evidence_required');
    if(!manifest.sourceEvidence.some(e=>codeExtensions.has(path.extname(e.path).toLowerCase())))issues.push('implementation_source_required_not_only_readme');
    if(manifest.codeUnavailableReason)issues.push('code_mode_cannot_claim_code_unavailable');
    for(const e of manifest.sourceEvidence){try{const actual=await readEvidenceRange(project,e);if(actual.fileSha256!==e.fileSha256||actual.excerptSha256!==e.excerptSha256)issues.push(`source_stale:${e.id}`);}catch{issues.push(`source_unavailable_or_forbidden:${e.id}`);}}
  }else{
    if(manifest.sourceEvidence.length)issues.push('url_only_cannot_claim_source_reading');
    if(!meaningful(manifest.codeUnavailableReason||'',20))issues.push('code_unavailable_reason_required');
    if(options.config.start)issues.push('url_only_requires_existing_site_no_unreviewed_start_command');
    if(!manifest.uiEvidence.length)issues.push('url_only_observed_ui_evidence_required');
    if(options.config.readyLocator&&!manifest.uiEvidence.some(e=>canonical(e.locator)===canonical(options.config.readyLocator)))issues.push('url_only_ready_locator_observation_required');
  }
  for(const e of manifest.uiEvidence){
    try{
      const u=validateUrl(e.url),allowed=new Set([new URL(options.config.url).origin,...(options.config.allowedOrigins||[])]);if(!allowed.has(u.origin))throw new Error('ui_origin_not_allowed');
      const age=now-Date.parse(e.observedAt);if(age< -300_000||age>(options.maxUiAgeHours??24)*3_600_000)throw new Error('ui_observation_stale');
      if(!meaningful(e.observation,16))throw new Error('ui_observation_description_missing');
      const f=await checkedFile(project,e.artifact.path,'ui');const data=await readFile(f.file);if(data.length>100_000||digest(data)!==e.artifact.sha256)throw new Error('ui_artifact_stale');noSensitivePatterns(data.toString('utf8'));
      const receipt=JSON.parse(data.toString('utf8'));
      if(receipt.schemaVersion!==1||receipt.kind!=='product-demo-ui-observation'||receipt.visible!==true||receipt.url!==e.url||receipt.observedAt!==e.observedAt||canonical(receipt.locator)!==canonical(e.locator)||receipt.observation!==e.observation)throw new Error('ui_receipt_mismatch');
    }catch{issues.push(`ui_evidence_invalid_or_stale:${e.id}`);}
  }
  const assertRefs=(refs:string[],label:string)=>{if(!refs.length||refs.some(r=>!evidenceIds.has(r)))issues.push(`evidence_links_missing:${label}`);if(manifest.mode==='code'&&!refs.some(r=>manifest.sourceEvidence.some(e=>e.id===r)))issues.push(`source_links_required:${label}`);};
  assertRefs(manifest.safeStart.evidenceIds,'safeStart');
  if(!manifest.flow.length)issues.push('authored_flow_required');const assigned=new Set<number>(),flowIds=new Set<string>();
  for(const step of manifest.flow){
    if(flowIds.has(step.id))issues.push('duplicate_flow_id');flowIds.add(step.id);
    if(!meaningful(step.summary,12)||!meaningful(step.success.description,12))issues.push(`flow_explanation_missing:${step.id}`);assertRefs(step.evidenceIds,step.id);
    if(manifest.mode==='url-only'&&!manifest.uiEvidence.some(e=>step.evidenceIds.includes(e.id)&&canonical(e.locator)===canonical(step.success.locator)))issues.push(`url_only_success_observation_required:${step.id}`);
    if(!step.actionIndexes.length)issues.push(`flow_actions_missing:${step.id}`);
    for(const i of step.actionIndexes){if(i>=options.config.actions.length)issues.push(`flow_action_out_of_range:${step.id}`);if(assigned.has(i))issues.push(`flow_action_assigned_twice:${i}`);assigned.add(i);}
  }
  options.config.actions.forEach((a,i)=>{if(!['pause','marker','screenshot'].includes(a.type)&&!assigned.has(i))issues.push(`action_without_source_explanation:${i}`);});
  return {status:issues.length?'blocked':'passed',issues:[...new Set(issues)],analysisHash:digest(raw),manifest,semanticUnderstandingVerified:false,manifestPath};
}
export async function assertUnderstanding(options:Parameters<typeof validateUnderstanding>[0]){const result=await validateUnderstanding(options);if(result.status!=='passed')throw new UnderstandingBlockedError(result.issues);return result;}

const AttemptSchema=z.object({attemptId:z.string(),stage:z.string(),inputHash:sha,status:z.enum(['running','passed','failed','abandoned']),pid:z.number().int(),startedAt:date,finishedAt:date.optional(),failureCode:z.string().optional()}).strict();
const LedgerSchema=z.object({schemaVersion:z.literal(1),attempts:z.array(AttemptSchema).max(2000)}).strict();
type Ledger=z.infer<typeof LedgerSchema>;
export class AttemptLimitError extends Error {readonly status='blocked';constructor(public readonly code:'stage_attempt_in_progress'|'stage_failure_limit'|'stage_total_failure_limit'|'attempt_ledger_locked',public readonly stage:string){super(`${code}: ${stage}; diagnose the saved failure before creating another run`);}}
function alive(pid:number){try{process.kill(pid,0);return true}catch{return false;}}
async function withLedger<T>(runDir:string,fn:(ledger:Ledger)=>Promise<T>|T):Promise<T>{
  await mkdir(runDir,{recursive:true});const root=await realpath(runDir),dir=path.join(root,'logs');await mkdir(dir,{recursive:true});if(!relativeInside(root,await realpath(dir)))throw new Error('attempt_ledger_directory_outside_run');
  const file=path.join(dir,'attempt-ledger.json'),lock=path.join(dir,'attempt-ledger.lock');let handle;
  try{handle=await open(lock,'wx',0o600);}catch(e:any){if(e.code!=='EEXIST')throw e;let owner:any;try{const actual=await realpath(lock);if(!relativeInside(root,actual)||(await stat(actual)).size>1000)throw new Error('invalid_lock');owner=JSON.parse(await readFile(actual,'utf8'));if(!Number.isInteger(owner.pid)||owner.pid<1)throw new Error('invalid_lock');}catch{throw new AttemptLimitError('attempt_ledger_locked','ledger');}if(alive(owner.pid))throw new AttemptLimitError('attempt_ledger_locked','ledger');await unlink(lock);handle=await open(lock,'wx',0o600);}
  await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));
  try{
    let ledger:Ledger={schemaVersion:1,attempts:[]};try{const actual=await realpath(file);if(!relativeInside(root,actual))throw new Error('attempt_ledger_file_outside_run');const s=await stat(actual);if(s.size>1_000_000)throw new Error('attempt_ledger_too_large');ledger=LedgerSchema.parse(JSON.parse(await readFile(actual,'utf8')));}catch(e:any){if(e.code!=='ENOENT')throw e;}
    let result:T;try{result=await fn(ledger);}catch(error){const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(ledger,null,2)+'\n',{mode:0o600});await rename(temp,file);throw error;}const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(ledger,null,2)+'\n',{mode:0o600});await rename(temp,file);return result;
  }finally{await handle.close();await unlink(lock);}
}
export async function beginStageAttempt(runDir:string,options:{stage:string;inputHash:string;maxFailedAttempts?:number;maxStageFailures?:number}){
  if(!/^[a-z][a-z0-9-]{0,39}$/.test(options.stage)||!sha.safeParse(options.inputHash).success)throw new Error('attempt_stage_or_hash_invalid');
  const maxFailedAttempts=options.maxFailedAttempts??2,maxStageFailures=options.maxStageFailures??4;
  if(!Number.isInteger(maxFailedAttempts)||maxFailedAttempts<1||maxFailedAttempts>5||!Number.isInteger(maxStageFailures)||maxStageFailures<maxFailedAttempts||maxStageFailures>10)throw new Error('attempt_limits_invalid');
  return withLedger(runDir,ledger=>{
    for(const a of ledger.attempts.filter(a=>a.stage===options.stage&&a.status==='running')){if(alive(a.pid))throw new AttemptLimitError('stage_attempt_in_progress',options.stage);a.status='abandoned';a.finishedAt=new Date().toISOString();a.failureCode='process_exited_without_completion';}
    const failed=ledger.attempts.filter(a=>a.stage===options.stage&&['failed','abandoned'].includes(a.status));
    if(failed.length>=maxStageFailures)throw new AttemptLimitError('stage_total_failure_limit',options.stage);
    if(failed.filter(a=>a.inputHash===options.inputHash).length>=maxFailedAttempts)throw new AttemptLimitError('stage_failure_limit',options.stage);
    const attempt={attemptId:randomUUID(),stage:options.stage,inputHash:options.inputHash,status:'running' as const,pid:process.pid,startedAt:new Date().toISOString()};ledger.attempts.push(attempt);return {attemptId:attempt.attemptId,stage:attempt.stage,inputHash:attempt.inputHash,previousInputFailures:failed.filter(a=>a.inputHash===options.inputHash).length,previousStageFailures:failed.length};
  });
}
export async function finishStageAttempt(runDir:string,options:{attemptId:string;status:'passed'|'failed';failureCode?:string}){
  if(options.failureCode&&!/^[a-zA-Z0-9_:-]{1,100}$/.test(options.failureCode))throw new Error('failure_code_must_be_identifier_not_raw_error_or_secret');
  return withLedger(runDir,ledger=>{const attempt=ledger.attempts.find(a=>a.attemptId===options.attemptId);if(!attempt)throw new Error('attempt_not_found');if(attempt.status===options.status)return attempt;if(attempt.status!=='running')throw new Error('attempt_already_finished');attempt.status=options.status;attempt.finishedAt=new Date().toISOString();if(options.status==='failed')attempt.failureCode=options.failureCode||'stage_failed';return attempt;});
}
