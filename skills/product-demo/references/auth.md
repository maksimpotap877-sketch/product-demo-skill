# Authentication handoff

Use `auth --config <absolute-path>` only for the intended product account. An external TTS provider has a separate login/API/budget flow. The built-in Windows voice provider does not require external login.

Authentication must use a dedicated persistent demo profile, outside run output and excluded from packaging and preview. Open a visible Playwright-managed browser and tell the user: «Войдите в открытом окне; после входа продолжим с сохранённого шага». The user handles passwords, OAuth, passkeys, CAPTCHA and two-factor authentication. Never ask for secrets in chat and never inspect their values.

During handoff there must be no video recording, screenshots, DOM snapshots, trace/HAR or input-value logging. Verify only the configured post-login URL or ready element. Record a technical checkpoint and the exact continuation command. Start capture only after the auth-only browser closes and a capture context has the supported saved state.

Cookies and localStorage export do not cover every site. SessionStorage, IndexedDB or SSO may need a persistent context; check what the installed backend supports. If it does not preserve this site's session, stop with a precise limitation instead of trying the user's everyday profile. Do not copy cookies from another browser or assume a browser connector shares state with Playwright.

If no interactive desktop exists, preserve `blocked: human_auth_required` and give a local command rather than claiming a window opened. A locally protected example can validate the mechanism; it does not prove a real third-party login was tested.
