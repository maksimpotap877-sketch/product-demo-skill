import React from 'react';
import {Freeze, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {EditPlan} from '../schema.js';
import {projectPoint, sampleCamera, sampleCursor, sceneGeometry, videoTiming} from './motion.js';

type Scene = EditPlan['scenes'][number];
const asset = (value: string) => staticFile(value.replaceAll('\\', '/'));

/** Hold the exact final sampled video frame, never a different screenshot or application state. */
export function SceneSource({scene}: {scene: Scene}) {
  const frame = useCurrentFrame(), {fps} = useVideoConfig();
  const style: React.CSSProperties = {width: '100%', height: '100%', display: 'block', objectFit: 'contain'};
  if (scene.kind === 'screenshot') return <Img src={asset(scene.sourcePath)} style={style}/>;
  const timing = videoTiming(scene, fps);
  return <Freeze frame={timing.lastFrame} active={frame >= timing.playableFrames}>
    {/* OffthreadVideo 4.x applies trimAfter to an unscaled Sequence. Freeze owns the end bound,
        so a slowed clip must not also receive that premature Sequence end. */}
    <OffthreadVideo muted src={asset(scene.sourcePath)} trimBefore={timing.trimBefore} playbackRate={scene.playbackRate} style={style}/>
  </Freeze>;
}

/** Flat, fixed application rectangle. Camera and pointer share one source-to-screen transform. */
export function ProductSurface({scene, plan}: {scene: Scene; plan: EditPlan}) {
  const frame = useCurrentFrame(), {width, fps} = useVideoConfig();
  const {box} = sceneGeometry(plan, scene);
  const pose = sampleCamera(scene.camera, frame, box);
  const pointer = sampleCursor(scene.events, frame, fps);
  const point = pointer ? projectPoint(pointer, box, pose) : null;
  return <div style={{position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height, overflow: 'hidden', borderRadius: width * .007, background: '#f4f5f9', boxShadow: '0 18px 60px #00000030', outline: '1px solid #ffffff25'}}>
    <div style={{position: 'absolute', width: box.width, height: box.height, transform: `translate(${pose.tx}px, ${pose.ty}px) scale(${pose.scale})`, transformOrigin: '0 0'}}><SceneSource scene={scene}/></div>
    {pointer && point && <div style={{position: 'absolute', left: point.x, top: point.y, opacity: pointer.opacity, filter: 'drop-shadow(0 1px 2px #00000040)'}}><svg width={width * .011} height={width * .016} viewBox="0 0 24 34"><path d="M2 2 L2 27 L8.5 21 L14 32 L19 29 L13.5 19 L23 19 Z" fill="#212638" stroke="white" strokeWidth="2"/></svg></div>}
    {scene.events.map((event, index) => {
      const age = (frame - event.frame) / fps;
      if (age < 0 || age >= .35) return null;
      const position = projectPoint(event, box, pose), size = width * (.009 + age * .025);
      return <div key={index} style={{position: 'absolute', left: position.x, top: position.y, width: size, height: size, transform: 'translate(-50%, -50%)', border: `2px solid ${plan.accent}`, borderRadius: '50%', opacity: .75 * (1 - age / .35)}}/>;
    })}
  </div>;
}
