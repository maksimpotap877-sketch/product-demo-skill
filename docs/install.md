# Установка переносимого Skill

Полная актуальная инструкция на русском: [INSTALL_RU.md](INSTALL_RU.md).

Из корня загруженного репозитория:

```powershell
npm ci --include=dev --ignore-scripts
npm run build
node dist/cli.js setup
node dist/cli.js skill install --client codex --scope user
node dist/cli.js skill status --client codex --json
```

Для Claude Code замените `codex` на `claude`; `both` устанавливает Skill в оба клиентских каталога с общей копией runtime. Исходный репозиторий после установки не нужен для запуска в других проектах. На другом компьютере установку надо повторить: служебный указатель на runtime привязан к этому компьютеру.

Перед записью реального продукта агент читает его исходники, заполняет `demo.understanding.json`, проверяет сценарий без записи и валидирует понимание. Для внешнего нейросетевого синтеза нужно разрешение на отправку текста; после него используется `--allow-external-tts`. Установка Skill такого разрешения не даёт.
