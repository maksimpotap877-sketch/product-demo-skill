import type {EditPlan} from '../schema.js';

type Scene = EditPlan['scenes'][number];
export type Size = {width: number; height: number};
export type Rect = Size & {x: number; y: number};
export type CameraPose = {scale: number; tx: number; ty: number};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** C2 easing: velocity and acceleration both reach zero at each authored endpoint. */
export const smoothStep = (value: number) => {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export function fitSource(area: Rect, source: Size): Rect {
  const ratio = Math.min(area.width / source.width, area.height / source.height);
  const width = source.width * ratio, height = source.height * ratio;
  return {x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height};
}

/** The work area is stable across product/detail scenes. Source aspect is never a cover crop. */
export function sceneGeometry(plan: EditPlan, scene: Scene) {
  const {width, height} = plan.profile;
  const portrait = height > width;
  const split = plan.presentation === 'cinematic' && !portrait && ['hero', 'outro'].includes(scene.layout ?? '');
  const area: Rect = split
    ? {x: width * .415, y: height * .18, width: width * .535, height: height * .65}
    : {x: width * .03, y: height * (portrait ? .22 : .095), width: width * .94, height: height * (portrait ? .54 : .8)};
  const source = scene.sourcePixels ?? plan.sourcePixels;
  return {area, box: fitSource(area, source), source, portrait, split};
}

export function cameraPose(size: Size, cue: Pick<Scene['camera'][number], 'scale' | 'x' | 'y'>): CameraPose {
  return {
    scale: cue.scale,
    tx: clamp(size.width / 2 - cue.x * size.width * cue.scale, size.width * (1 - cue.scale), 0),
    ty: clamp(size.height / 2 - cue.y * size.height * cue.scale, size.height * (1 - cue.scale), 0),
  };
}

/** Clamp endpoints once, then interpolate transforms together: no mid-move edge-clamp kink. */
export function sampleCamera(keys: Scene['camera'], frame: number, size: Size): CameraPose {
  const next = keys.findIndex(key => key.frame > frame);
  if (next === 0) return cameraPose(size, keys[0]);
  if (next < 0) return cameraPose(size, keys[keys.length - 1]);
  const before = keys[next - 1], after = keys[next];
  const t = smoothStep((frame - before.frame) / (after.frame - before.frame));
  const a = cameraPose(size, before), b = cameraPose(size, after);
  return {scale: mix(a.scale, b.scale, t), tx: mix(a.tx, b.tx, t), ty: mix(a.ty, b.ty, t)};
}

export const projectPoint = (point: {x: number; y: number}, size: Size, pose: CameraPose) => ({
  x: pose.tx + point.x * size.width * pose.scale,
  y: pose.ty + point.y * size.height * pose.scale,
});

export function videoTiming(scene: Pick<Scene, 'sourceStartMs' | 'sourceEndMs' | 'playbackRate'>, fps: number) {
  // Trim coordinates may be fractional: retain millisecond source cuts instead of rounding them.
  const trimBefore = scene.sourceStartMs * fps / 1000;
  const trimAfter = scene.sourceEndMs * fps / 1000;
  const playableFrames = Math.max(1, Math.ceil((trimAfter - trimBefore) / scene.playbackRate - 1e-8));
  return {trimBefore, trimAfter, playableFrames, lastFrame: playableFrames - 1};
}

export function sampleCursor(events: Scene['events'], frame: number, fps: number) {
  if (!events.length) return null;
  const next = events.findIndex(event => event.frame > frame);
  const first = events[0], last = events[events.length - 1];
  let x = first.x, y = first.y;
  if (next < 0) {x = last.x; y = last.y;}
  else if (next > 0) {
    const a = events[next - 1], b = events[next];
    const start = Math.max(a.frame, b.frame - fps * .9);
    const t = smoothStep((frame - start) / Math.max(1, b.frame - start));
    x = mix(a.x, b.x, t); y = mix(a.y, b.y, t);
  }
  const fadeIn = smoothStep((frame - (first.frame - fps * .4)) / Math.max(1, fps * .2));
  const fadeOut = 1 - smoothStep((frame - (last.frame + fps * .45)) / Math.max(1, fps * .25));
  return {x, y, opacity: fadeIn * fadeOut};
}

/** Deterministic geometric checks; they are not a subjective normal-speed viewing review. */
export function inspectMotionGeometry(plan: EditPlan) {
  const issues: string[] = [];
  const scenes = plan.scenes.map(scene => {
    const {box, source} = sceneGeometry(plan, scene);
    const fps = plan.profile.fps;
    const speedLimit = Math.min(plan.profile.width, plan.profile.height) * .8;
    let maximumPanPixelsPerSecond = 0, maximumScalePerSecond = 0;
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.x + box.width > plan.profile.width + .001 || box.y + box.height > plan.profile.height + .001) issues.push(`${scene.sceneId}: source rectangle exceeds canvas`);
    if (Math.abs(box.width / box.height - source.width / source.height) > .00001) issues.push(`${scene.sceneId}: source aspect is distorted`);
    if (scene.camera.some((key, index, keys) => !Number.isInteger(key.frame) || key.frame < 0 || key.frame >= scene.outputDurationFrames || (index > 0 && key.frame <= keys[index - 1].frame))) issues.push(`${scene.sceneId}: camera frame order or bounds invalid`);
    for (let i = 1; i < scene.camera.length; i++) {
      const a = scene.camera[i - 1], b = scene.camera[i];
      const pa = cameraPose(box, a), pb = cameraPose(box, b);
      const moving = Math.hypot(pb.tx - pa.tx, pb.ty - pa.ty) > 1 || Math.abs(pb.scale - pa.scale) > .001;
      if (moving && (b.frame - a.frame) / fps < .6) issues.push(`${scene.sceneId}: camera move shorter than 0.6 seconds`);
    }
    let previous = sampleCamera(scene.camera, 0, box);
    for (let frame = 1; frame < scene.outputDurationFrames; frame++) {
      const pose = sampleCamera(scene.camera, frame, box);
      const panSpeed = Math.hypot(pose.tx - previous.tx, pose.ty - previous.ty) * fps;
      maximumPanPixelsPerSecond = Math.max(maximumPanPixelsPerSecond, panSpeed);
      maximumScalePerSecond = Math.max(maximumScalePerSecond, Math.abs(pose.scale - previous.scale) * fps);
      if (![pose.scale, pose.tx, pose.ty].every(Number.isFinite) || pose.tx > .001 || pose.ty > .001 || pose.tx < box.width * (1 - pose.scale) - .001 || pose.ty < box.height * (1 - pose.scale) - .001) {issues.push(`${scene.sceneId}: camera leaves source bounds at frame ${frame}`); break;}
      previous = pose;
    }
    if (maximumPanPixelsPerSecond > speedLimit) issues.push(`${scene.sceneId}: camera pan exceeds ${speedLimit.toFixed(0)} screen pixels/second`);
    if (maximumScalePerSecond > .45) issues.push(`${scene.sceneId}: camera zoom exceeds 0.45 scale/second`);
    return {sceneId: scene.sceneId, box, source, maximumPanPixelsPerSecond, maximumScalePerSecond, speedLimit};
  });
  return {status: issues.length ? 'failed' as const : 'passed' as const, issues, scenes, method: 'Shared renderer geometry sampled at every output frame; source aspect, camera bounds, minimum move time and velocity budgets', subjectiveMotion: 'not-tested' as const};
}
