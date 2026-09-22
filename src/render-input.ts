import path from 'node:path';
import {probe,safeFile} from './util.js';
import type {EditPlan} from './schema.js';
/** Bind editable plan duration claims to actual local media before expensive rendering. */
export async function validateRenderMedia(runDir:string,plan:EditPlan){
 const memo=new Map<string,any>();
 const media=async(p:string)=>{if(!memo.has(p))memo.set(p,await probe(await safeFile(runDir,p)));return memo.get(p);};
 for(const s of plan.scenes){const source=await media(s.sourcePath);if(s.kind==='video'){const durationMs=Number(source.format.duration)*1000;if(!Number.isFinite(durationMs)||s.sourceEndMs>durationMs+1||s.sourceStartMs>=durationMs)throw new Error(`Source range exceeds actual media: ${s.sceneId}`);}else if(!source.streams.some((v:any)=>v.width>0&&v.height>0))throw new Error('Screenshot is not a decodable image');
  if(s.voicePath){const a=await media(s.voicePath);if(Math.abs(Number(a.format.duration)*1000-s.voiceDurationMs)>5)throw new Error(`Voice duration differs from actual audio: ${s.sceneId}`);}
 }
 if(plan.fullTrack){const a=await media(plan.fullTrack);if(Math.abs(Number(a.format.duration)*1000-(plan.fullTrackDurationMs??0))>5)throw new Error('Full track duration differs from actual audio');}
 return {status:'passed',mediaCount:memo.size,method:'ffprobe local assets plus safe real paths and actual duration ranges'};
}
