# Product edit decisions

Start with one observed benefit and one completed interaction. Give each scene a purpose: establish the product, show the action, reveal the relevant detail, and show the actual result. Vary framing to support this sequence. Keep large titles mainly for the opening and conclusion; let the working UI occupy the screen during interaction. Avoid repeating the same title, frame and progress strip for every scene.

The config's `presentation` is `cinematic` by default; `classic` preserves the earlier presentation. Storyboard `layout` accepts `hero`, `product`, `detail`, `outro`. These are editable choices, not substitutes for reviewing the composition. Preserve the user's branding and tone rather than applying arbitrary decoration.

Each storyboard scene can set `sourceKind` to `screenshot` or `video`, `durationSec`, `playbackRate`, and `camera`. Camera cues contain `at` from 0 to 1 within the scene, `scale` from 1 to 3, and normalized source coordinates `x`, `y` from 0 to 1. Times must increase strictly. The planner converts cues to frame positions for the chosen output fps. For example:

```json
{
  "sceneId": "save-result",
  "meaning": "Show that the new collection exists",
  "visibleResult": "The new collection appears in the library",
  "displayText": "Подборка готова",
  "spokenText": "Подборка сохранена в библиотеке.",
  "screenshotId": "saved",
  "sourceKind": "screenshot",
  "layout": "outro",
  "durationSec": 4,
  "camera": [
    {"at": 0, "scale": 1.3, "x": 0.55, "y": 0.45},
    {"at": 1, "scale": 1.1, "x": 0.5, "y": 0.5}
  ]
}
```

Use a real action clip for clicks, typing or scrolling. Set `clipId`, `sourceStartMs`, `sourceEndMs` from the capture manifest and inspect the actual clip. Trim preparation and dead time, but retain enough context before the action and enough time to read the result. A screenshot can hold a completed state; it must not impersonate a recorded interaction. A generated cursor interpolates measured click endpoints, not a measured continuous pointer trajectory.

Focus camera movement on the UI element being discussed. Keep the target, cursor, captions and relevant surrounding context visible at maximum zoom. Make the useful text readable at the final output size. Use a restrained move that settles before the click or result; avoid constant motion that competes with the product. Match narration to the moment the feature becomes visible. Never accelerate long speech merely to fit a preset shot.

Review the cut as a whole: opening clarity, dead time, repeated framing, abrupt scale jumps, cursor accuracy, caption placement and a conclusive result. Inspect before/at/after clicks, all camera extremes and transitions. Check normal-speed playback separately; screenshots and a 144 fps file header cannot establish smooth motion. A decorative counter or progress animation does not prove the product footage has native 144 fps.

For revisions, edit the run's storyboard and regenerate plan/render/QA. Re-narrate only if speech changed. If editing `edit-plan.json` directly, render/inspect without running `plan`, which would regenerate it. Reuse capture unless the product state or interaction itself must change. Preserve the old result and report what changed.
