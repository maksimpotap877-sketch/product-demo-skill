import {probe,safeFile} from './util.js';
import type {EditPlan} from './schema.js';
import {inspectMotionGeometry} from './render/motion.js';
/** Bind editable plan duration claims to actual local media before expensive rendering. */
export async function validateRenderMedia(runDir:string,plan:EditPlan){
 const memo=new Map<string,any>();
 const media=async(p:string)=>{if(!memo.has(p))memo.set(p,await probe(await safeFile(runDir,p)));return memo.get(p);};
 const geometry:{sceneId:string;width:number;height:number;binding:string}[]=[];
 for(const s of plan.scenes){const source=await media(s.sourcePath);const stream=source.streams.find((v:any)=>v.codec_type==='video'&&v.width>0&&v.height>0);if(!stream)throw new Error(`Source is not decodable visual media: ${s.sceneId}`);if(s.kind==='video'){const durationMs=Number(source.format.duration)*1000;if(!Number.isFinite(durationMs)||s.sourceEndMs>durationMs+1||s.sourceStartMs>=durationMs)throw new Error(`Source range exceeds actual media: ${s.sceneId}`);}
  const expected=s.sourcePixels??plan.sourcePixels;
  if(s.sourcePixels&&(stream.width!==expected.width||stream.height!==expected.height))throw new Error(`Source dimensions differ from actual media: ${s.sceneId}`);
  if(Math.abs(stream.width/stream.height-expected.width/expected.height)>.00001)throw new Error(`Source aspect differs from actual media: ${s.sceneId}`);
  geometry.push({sceneId:s.sceneId,width:stream.width,height:stream.height,binding:s.sourcePixels?'exact-scene-pixels':'legacy-aspect-only'});
  if(s.voicePath){const a=await media(s.voicePath);if(Math.abs(Number(a.format.duration)*1000-s.voiceDurationMs)>5)throw new Error(`Voice duration differs from actual audio: ${s.sceneId}`);}
 }
 if(plan.fullTrack){const a=await media(plan.fullTrack);if(Math.abs(Number(a.format.duration)*1000-(plan.fullTrackDurationMs??0))>5)throw new Error('Full track duration differs from actual audio');}
 const motion=inspectMotionGeometry(plan);if(motion.status==='failed')throw new Error('Geometry/motion preflight failed: '+motion.issues.join('; '));
 return {status:'passed',mediaCount:memo.size,geometry,motion,method:'ffprobe local assets plus actual dimensions/duration ranges and shared renderer geometry'};
}
