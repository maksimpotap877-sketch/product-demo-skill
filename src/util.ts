import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const VERSION='0.3.0';
export const PACKAGE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const hash=(x:unknown)=>createHash('sha256').update(typeof x==='string'||x instanceof Uint8Array?x:JSON.stringify(x)).digest('hex');
export async function readJson<T=any>(file:string):Promise<T>{return JSON.parse(await readFile(file,'utf8'));}
export async function writeJson(file:string,value:unknown){await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2)+'\n');await rename(tmp,file);}
export function contained(root:string,relative:string){const p=path.resolve(root,relative);const rel=path.relative(path.resolve(root),p);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Path escapes allowed directory');return p;}
export async function safeFile(root:string,relative:string){const p=contained(root,relative);const real=await realpath(p);contained(await realpath(root),path.relative(await realpath(root),real));return real;}
export function run(exe:string,args:string[],options:{cwd?:string;timeoutMs?:number}={}):Promise<{stdout:string;stderr:string}>{return new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd:options.cwd,windowsHide:true,shell:false});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error(`${path.basename(exe)} timed out`));},options.timeoutMs??120000);child.stdout.on('data',d=>{stdout+=d;if(stdout.length>100_000_000){child.kill();reject(new Error('Process output exceeds limit'));}});child.stderr.on('data',d=>{stderr=(stderr+d).slice(-8_000_000);});child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);code===0?resolve({stdout,stderr}):reject(new Error(`${path.basename(exe)} exit ${code}: ${stderr.slice(-3500)}`));});});}
export async function probe(file:string){return JSON.parse((await run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file])).stdout);}
export const log=(s:string)=>process.stderr.write(s+'\n');
