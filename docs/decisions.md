# Решения и проверенные источники

22.09.2026. Windows 11 Home 10.0.26200; Node 24.19.0; Codex CLI 0.147.0; FFmpeg 8.1.1.
Установлены из npm стабильные версии: Playwright 1.63.0; все Remotion 4.0.527. Lockfile фиксирует транзитивные зависимости.

- [Codex Skills](https://learn.chatgpt.com/docs/build-skills): пользовательская область ~/.agents/skills; обычная копия, manifest для versioned runtime, без symlink.
- [Codex MCP](https://developers.openai.com/codex/mcp/): новый сервер не нужен для библиотечного Playwright. Чужую конфигурацию не меняем.
- [Playwright video](https://playwright.dev/docs/videos): запись завершается закрытием context, размер задаётся явно. Частоту не считаем native144 без измерений.
- [Playwright auth](https://playwright.dev/docs/auth): отдельный локальный профиль, visible handoff без capture/trace; публичный preview не содержит профиль.
- [Remotion renderer](https://www.remotion.dev/docs/renderer/render-media): покадровая локальная композиция; источники подготовлены до рендера. Только согласованные версии пакетов.
- [Remotion license](https://www.remotion.dev/docs/license): лицензия зависит от пользователя/организации; отсутствие оплаты в этой проверке не означает бесплатность любого коммерческого использования.
- [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html): измерение аудио и loudnorm; native и presentation рендеры различаются.

Единицы sourceTimeMs/outputFrame разделены. Кадры вычисляются из абсолютного времени, не накапливают округление. Субтитры используют границы реально синтезированных сегментов; пословный alignment не выдумывается.
Геометрия источника измеряется. Static screenshots не обозначаются непрерывной записью. Обоснования backend/голосов — capture.md и narration.md.
