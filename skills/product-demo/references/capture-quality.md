# Source capture and rendered cadence

Record these quantities separately: CSS viewport, measured capture pixels, capture target fps, observed unique source updates per second, display refresh when applicable, composition fps and output pixels. Neither `-r 144` nor `ffprobe`'s advertised rate proves 144 unique UI states per second. DPR does not prove video resolution.

Run `benchmark --target-fps 144` before a large high-frame-rate render. The benchmark's controlled movement/frame marker and decoded timestamps provide evidence; report its method, measured values and tolerances. Compression noise is not a new app state. Static-screen duplicate frames are expected and cannot measure motion cadence.

The installed release supports the documented Playwright video path plus real screenshots. Consult the actual benchmark and backend manifest for current limits. A backend being listed or probed is not evidence that capture with it worked. Native 144 may remain blocked by backend, refresh rate or desktop access; never silently downgrade that request. `--strict-native-fps` is intended to make the unmet criterion visible.

Hybrid presentation uses real screenshots for states and source clips for actions, with camera, cursor, captions and transitions rendered at the composition cadence. Label screenshot scenes and any low-fps clips in provenance. A 144 fps Remotion composition may have new overlay frames while the captured UI updates much less frequently. Do not call that native 144 capture.

Supported profiles are `master-144` (2560×1440 at 144), `web-60` (1920×1080 at 60), `vertical` (1080×1920 at 60), `square` (1080×1080 at 60) and `4k-60` (3840×2160 at 60). These are render targets, not capture guarantees. Validate custom profiles against installed help/schema and hardware. Vertical framing needs its own plan and visible action targets. Do not present upscaled Full HD footage as native QHD/4K detail.

Inspect source clock mapping, event timestamps, navigation/page IDs and pointer coordinates. `locator.click()` command start can precede the actual pointerdown after scrolling/auto-wait. Capture provenance and any timing uncertainty must remain in the quality report.
