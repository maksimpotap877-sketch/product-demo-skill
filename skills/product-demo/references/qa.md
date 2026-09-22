# Evidence and delivery

`inspect --run <absolute-path>` performs technical checks and emits the quality report/contact sheet. `preview --run <absolute-path>` serves a loopback preview of allowed artifacts. It must not expose the repository root, credentials, profiles or arbitrary paths.

Check full video/audio decode, measured resolution, duration, timestamps/frame count, source bounds, scene/event timing, narration duration, safe areas and the final encoded audio's loudness/peaks. A successful render process alone does not prove these properties. Intentional still scenes should not fail a generic freeze detector.

Open the contact sheet and additional frames near clicks, scrolls, transitions, maximum zoom and the end. Confirm visible product/result, readable Russian text, accurate cursor targets, no double cursor, no login UI/DevTools and no known private fields. Assess scene variety, framing, pacing and whether the result is understandable; a technical pass does not approve the edit. A visual inspection of stills does not prove smooth motion. If normal-speed video playback or audio listening is unavailable, record those checks as `not-tested` and provide media for the user. Do not claim a neural voice sounds natural merely because synthesis and decoding succeeded.

Review the export manifest, narrated text, events and visible frames for sensitive content; regex scanning is limited and is not an absolute privacy guarantee. Do not upload private media to another service as an implicit QA step.

Report `passed`, `failed`, `blocked`, `not-tested` and `degraded` per criterion. Keep technical measurement, visual agent review and subjective audio review separate. Native capture 144, rendered animation 144, web-60 export, male synthesis and female synthesis are separate acceptance results.

Deliver links to the actual video, two voice samples when generated, preview and report. Include source resolution/cadence, output resolution/fps, voice provider/ID, known costs and unmet checks. A fallback file whose native-capture criterion failed must say degraded/preview in the filename/report. Preserve one exact command for the next action. Do not call the project fully verified while a key criterion is blocked or untested.
