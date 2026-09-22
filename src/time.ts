export const msToFrame=(ms:number,fps:number)=>Math.round(ms*fps/1000);
export const frameToMs=(frame:number,fps:number)=>frame*1000/fps;
export function mapEvent(sourceMs:number,scene:{sourceStartMs:number;sourceEndMs:number;outputStartFrame:number;playbackRate:number},fps:number){if(sourceMs<scene.sourceStartMs||sourceMs>scene.sourceEndMs)return null;return scene.outputStartFrame+msToFrame((sourceMs-scene.sourceStartMs)/scene.playbackRate,fps);}
export function cameraTransform(width:number,height:number,scale:number,x:number,y:number){return {scale,tx:Math.max(width*(1-scale),Math.min(0,width/2-x*width*scale)),ty:Math.max(height*(1-scale),Math.min(0,height/2-y*height*scale))};}
export const coordinate=(css:{x:number;y:number},viewport:{width:number;height:number},source:{width:number;height:number})=>({x:css.x/viewport.width*source.width,y:css.y/viewport.height*source.height});
