import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorialReviewSchema,editorialDelivery,validateEditorialArtifact} from '../src/editorial-review.js';

const fixture=()=>({schemaVersion:1,artifactSha256:'a'.repeat(64),durationSec:12,reviewer:'Test reviewer',reviewedAt:'2026-09-23T12:00:00.000Z',checks:['content','framing','motion','audio'].map(criterion=>({criterion,status:'passed',method:criterion==='motion'?'normal-speed-playback':criterion==='audio'?'listening':'frames-and-source',coverage:[{startSec:0,endSec:12}],notes:'Fixture evidence only.'})),defects:[] as any[]});

test('still frames and technical measurements cannot be imported as motion/listening passes',()=>{
 const r=fixture();r.checks[2].method='frames-and-source';assert.throws(()=>EditorialReviewSchema.parse(r),/normal-speed-playback/);
 r.checks[2].method='normal-speed-playback';r.checks[3].method='frames-and-source';assert.throws(()=>EditorialReviewSchema.parse(r),/listening/);
});
test('sampled playback or a gap in coverage is a candidate, not full-motion pass',()=>{
 const r=fixture();r.checks[2].coverage=[{startSec:0,endSec:4},{startSec:5,endSec:12}];assert.throws(()=>EditorialReviewSchema.parse(r),/complete normal-speed/);
 r.checks[2].status='not-tested';assert.equal(editorialDelivery(EditorialReviewSchema.parse(r)),'review-candidate');
});
test('review survives multiple contiguous playback intervals but never a changed artifact',()=>{
 const r=fixture();r.checks[2].coverage=[{startSec:6,endSec:12},{startSec:0,endSec:6}];
 assert.equal(editorialDelivery(validateEditorialArtifact(r,'a'.repeat(64),12)),'reviewed');
 assert.throws(()=>validateEditorialArtifact(r,'b'.repeat(64),12),/different export/);
 assert.throws(()=>validateEditorialArtifact(r,'a'.repeat(64),13),/duration differs/);
});
test('open timecoded defects cannot coexist with a pass and require changes',()=>{
 const r=fixture();r.defects=[{atSec:3,criterion:'motion',symptom:'Jump at the trim boundary.',correction:'Pending',status:'open',evidence:'Frames 179–181.'}];
 assert.throws(()=>EditorialReviewSchema.parse(r),/unresolved defect/);
 r.checks[2].status='failed';assert.equal(editorialDelivery(EditorialReviewSchema.parse(r)),'changes-required');
});
test('review must cover each distinct criterion exactly once',()=>{
 const r=fixture();r.checks[3]={...r.checks[2]};assert.throws(()=>EditorialReviewSchema.parse(r),/exactly once/);
});
