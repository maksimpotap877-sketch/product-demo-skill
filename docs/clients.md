# Codex, Claude Code и GLM: подключение и границы совместимости

Руководство проверено по официальной документации 23 сентября 2026 года. Начните с [установки toolkit](GETTING_STARTED_RU.md) или [подробного описания установщика](INSTALL_RU.md). Ниже описано, где агент найдёт инструкции и как получит доступ к локальному исполнителю.

## Что подключается

В проекте есть две части: папка Skill с `SKILL.md` и исполняемый toolkit с Node.js CLI. Skill объясняет агенту, как исследовать продукт, выбрать сценарий, записать браузер, подготовить речь и проверить видео. CLI выполняет эти операции на машине пользователя. Копирование одного `SKILL.md` не устанавливает FFmpeg, браузер, Python и runtime.

Codex и Claude Code — клиенты, которые читают файлы и запускают инструменты. GLM — семейство моделей; ему нужен такой клиент, например OpenCode или Claude Code с провайдером Z.AI. Отдельной стандартной папки «GLM Skills» у toolkit нет. API модели, браузерная авторизация продукта и сервис озвучки настраиваются независимо.

| Среда | Каталог персонального Skill | Вызов | Что проверено здесь |
|---|---|---|---|
| Codex, локальная сессия | `~/.agents/skills/product-demo` | `$product-demo` | Windows, обнаружение Skill, установленный launcher, второй проект и видео |
| Claude Code, локальная сессия | `~/.claude/skills/product-demo` | `/product-demo` | Предусмотрен установщик и документированная структура; E2E внутри Claude Code не заявлен |
| OpenCode с GLM | Поддерживает `~/.agents/skills` и `~/.claude/skills` | Попросить загрузить Skill `product-demo` | Путь подключения сверён с документацией; E2E с GLM не проводился |
| Браузерный чат без доступа к машине | Локальные каталоги недоступны | Нет эквивалентного локального запуска | Загрузка Markdown в чат сама по себе не даёт доступ к записи и рендеру |

`~` означает домашнюю папку пользователя; в обычной Windows это `$env:USERPROFILE`. В Claude Code учитывается также пользовательский `CLAUDE_CONFIG_DIR`. Каталоги клиентов описаны в [Codex Skills](https://learn.chatgpt.com/docs/build-skills), [Claude Code Skills](https://code.claude.com/docs/en/skills) и [OpenCode Agent Skills](https://opencode.ai/docs/skills/).

## Codex

Из корня собранного репозитория:

```powershell
node dist/cli.js skill install --client codex --scope user
node dist/cli.js skill status --client codex --scope user --json
```

Установщик создаёт независимый runtime и размещает Skill в пользовательском каталоге. Проверить его без зависимости от текущей папки можно так:

```powershell
$demoLauncher = Join-Path $env:USERPROFILE '.agents/skills/product-demo/scripts/run.mjs'
node $demoLauncher --help
node $demoLauncher doctor --json
```

Откройте нужный продукт в локальной сессии Codex. Если Skill отсутствует в списке, начните новую сессию или обновите список Skills. Официальное обнаружение локальных Skills включает пользовательскую и проектную `.agents/skills`; установка в папку другого клиента не заменяет этот механизм. [Документация Codex](https://learn.chatgpt.com/docs/build-skills).

Пример запроса после установки:

> $product-demo Создай русское демо текущего продукта на 30 секунд. Сначала изучи исходники и собери demo.understanding.json: пользователь, задача, ключевой сценарий и признак успеха. Проверь сценарий в браузере без записи. Используй женский нейросетевой голос. Передавать сервису озвучки разрешаю только согласованный публичный текст сценария. Подготовь web-60, отдельный отчёт качества и честно укажи частоту исходной записи. Не повторяй неудачную операцию без новой гипотезы.

Если подключение Codex к аккаунту ещё не настроено, выполните штатный вход в интерфейсе самого клиента. Toolkit не получает ключ OpenAI и не выбирает модель Codex за пользователя.

Для установки только в один проект:

```powershell
node dist/cli.js skill install --client codex --scope project --project 'C:/Projects/MyProduct'
```

Не создавайте одновременно пользовательскую и проектную копии с одним именем без необходимости. `skill status` помогает найти конфликтующие установки. Подробности обновления и удаления — в [INSTALL_RU.md](INSTALL_RU.md).

## Claude Code

Нужен именно Claude Code с доступом к терминалу и файлам локального проекта. Настройки обычного чата Claude Desktop и его MCP-коннекторов не следует переносить в Claude Code как взаимозаменяемые.

Если Claude Code ещё не установлен, официальный Windows-вариант:

```powershell
winget install Anthropic.ClaudeCode
claude --version
```

Проверьте действующие системные требования и способ обновления в [Claude Code setup](https://code.claude.com/docs/en/setup). Вход выполните через штатный интерфейс клиента; пароль и ключ не нужно передавать агенту в сообщении.

После установки toolkit:

```powershell
node dist/cli.js skill install --client claude --scope user
node dist/cli.js skill status --client claude --scope user --json
```

Персональные Skills Claude Code находятся в `~/.claude/skills`, проектные — в `.claude/skills`. Инструкции запускаются как `/product-demo` и могут подбираться клиентом по описанию. Это поддержка формата клиента; подтверждение успешного видео требует отдельного запуска в нём. [Claude Code Skills](https://code.claude.com/docs/en/skills).

Проверка launcher в обычной Windows-конфигурации:

```powershell
$demoClaudeRoot = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$demoLauncher = Join-Path $demoClaudeRoot 'skills/product-demo/scripts/run.mjs'
node $demoLauncher --help
node $demoLauncher doctor --json
Set-Location 'C:/Projects/MyProduct'
claude
```

Внутри Claude Code:

> /product-demo Сделай демо текущего приложения. Сначала прочитай код, проверь пользовательский поток и подготовь понимание продукта. Затем создай видео и отчёт. Не выдумывай признаки успеха и возможности интерфейса.

Для командной инструкции проекта используйте шаблон [agent-instructions/CLAUDE.md](agent-instructions/CLAUDE.md). Добавьте подходящий раздел в уже существующий `CLAUDE.md`; не заменяйте чужие инструкции целиком. Skill содержит общий процесс, а проектный файл — правила конкретного приложения.

Если используются оба клиента:

```powershell
node dist/cli.js skill install --client both --scope user
node dist/cli.js skill status --client both --scope user --json
```

Будут две папки для обнаружения и один общий runtime. Не копируйте служебный `.runtime-location.json` с чужого компьютера: в нём указан локальный путь. На другом компьютере выполните установку заново.

## GLM через OpenCode

Для GLM наиболее прямой документированный маршрут здесь — OpenCode с провайдером Z.AI. Это настройка клиента модели; toolkit и `demo.config.json` не должны хранить её ключ.

Официальное руководство Z.AI предлагает:

```powershell
npm install -g opencode-ai
opencode auth login
```

Выберите `Z.AI` для соответствующего API-доступа либо `Z.AI Coding Plan`, если используете этот план. Ключ вводите только в локальном интерфейсе авторизации. Затем запустите `opencode`, выполните `/models` и выберите доступную вашему аккаунту модель GLM. Точный доступ и стоимость зависят от аккаунта, поэтому toolkit не фиксирует выдуманную бесплатную подписку или универсальное имя модели. [Официальное подключение Z.AI к OpenCode](https://docs.z.ai/devpack/tool/opencode).

Для обнаружения нашего Skill достаточно одной установки:

```powershell
node dist/cli.js skill install --client codex --scope user
Set-Location 'C:/Projects/MyProduct'
opencode
```

OpenCode документирует чтение `.agents/skills` и `.claude/skills` на уровне проекта и пользователя. Не устанавливайте `both` исключительно ради OpenCode: клиент может обнаружить обе копии. Попросите агента загрузить `product-demo`, прочитать его инструкции и проверить launcher. [OpenCode Agent Skills](https://opencode.ai/docs/skills/).

Текст запроса:

> Загрузи Skill product-demo. Для текущего проекта сначала изучи исходники и подготовь проверяемое понимание продукта. После успешной валидации выполни нужные команды установленного toolkit и сохрани готовое видео. Если у модели нет просмотра изображений или прослушивания, оставь соответствующий QA not-tested.

Поддержка tools, изображений и ограничения контекста зависят от выбранной модели и клиента. Наличие GLM в `/models` не доказывает, что весь workflow исполнен. В этом репозитории запуск под GLM обозначен `not-tested` до отдельной проверки.

## GLM через Claude Code

Z.AI также публикует настройку Claude Code через Anthropic-совместимый адрес. Настройка заменяет провайдера модельных запросов Claude Code; она не превращает подписку Claude в подписку Z.AI. Перед выбором провайдера учитывайте, куда клиент будет отправлять код и сообщения.

Документированный интерактивный помощник:

```powershell
npx @z_ai/coding-helper
```

В нём выберите Claude Code и свой вариант доступа. Выполняйте настройку в собственном локальном терминале. Ключи не публикуйте в README, `demo.config.json`, `.env` репозитория, CLI-аргументах или чате. Ручная настройка описана у Z.AI; основные имена параметров: `ANTHROPIC_BASE_URL` с адресом `https://api.z.ai/api/anthropic`, секретный `ANTHROPIC_AUTH_TOKEN` и отображение моделей через `ANTHROPIC_DEFAULT_*_MODEL`. Значения моделей сверяйте с текущим каталогом своего аккаунта. [Z.AI: Claude Code](https://docs.z.ai/devpack/tool/claude).

Затем установите Skill с `--client claude`, откройте новый Claude Code в проекте и вызовите `/product-demo`. Workflow Skill остаётся тем же. Этот маршрут описан по документации провайдера; в рамках проверки toolkit не было входа в Z.AI, оплаченных модельных вызовов или E2E через Claude Code + GLM.

## Remotion: документация, Skills и необязательный MCP

Remotion уже входит в зависимости toolkit и локально рендерит React-композицию. Для этого не требуется отдельный MCP-сервер. MCP не даёт автоматически ни записи сайта, ни монтажа, ни улучшения озвучки.

Официальный Remotion MCP помечен deprecated; для новой установки рекомендуется `remotion-docs`. Он помогает агенту находить текущую документацию. В корне toolkit доступна официальная установка:

```powershell
npx remotion skills add
```

Альтернативный официальный каталог:

```powershell
npx skills add remotion-dev/skills
```

В интерактивном выборе устанавливайте только нужные Skills и нужного клиента. После установки попросите агента использовать `remotion-docs` и реально найти страницу по нужному API. [Remotion Agent Skills](https://www.remotion.dev/docs/ai/skills), [переход с MCP](https://www.remotion.dev/docs/ai/mcp).

Если старый MCP нужен для совместимости, ниже приведена конфигурация проверенной ранее версии. Она не гарантирует, что удалённый сервис продолжит отвечать. Для Windows оболочка `cmd /c` здесь только запускает npm-команду; операций с пользовательскими файлами в ней нет:

```powershell
codex mcp add remotion-documentation -- cmd /c npx -y @remotion/mcp@4.0.527
codex mcp list
```

Либо для Claude Code:

```powershell
claude mcp add --transport stdio --scope user remotion-documentation -- cmd /c npx -y @remotion/mcp@4.0.527
claude mcp list
claude mcp get remotion-documentation
```

В macOS/Linux уберите `cmd /c`; эти платформы для toolkit пока не проверены. Перед добавлением просмотрите текущий список, чтобы не создать дубликат. Форматы клиентских команд: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude Code MCP](https://code.claude.com/docs/en/mcp).

После изменения конфигурации начните новую сессию, проверьте список инструментов и выполните один запрос документации. Запись в конфиге, успешное соединение и успешный вызов — разные проверки. Для Remotion MCP исторически проверены initialization, tools/list и запрос документации в Codex на Windows; это не тест Claude Code или GLM.

Codex хранит MCP-настройки в `~/.codex/config.toml` либо доверенном проектном `.codex/config.toml`; штатная команда добавляет запись, сохраняя соседние настройки. Не заменяйте весь файл готовым примером. [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Для Claude Code используйте его `claude mcp` и `/mcp`, а не конфигурацию отдельного чата Claude Desktop. [Claude Code MCP](https://code.claude.com/docs/en/mcp).

## Как проверить перенос в выбранный клиент

1. Новый клиент видит `product-demo` и может прочитать `SKILL.md` вместе с `references/`.
2. Агент запускает установленный `scripts/run.mjs --help` из папки другого проекта.
3. `doctor` видит Node, FFmpeg и браузер; выбранный TTS проверен отдельной пробой.
4. Агент читает код, заполняет `demo.understanding.json` и проходит `analyze --validate`.
5. Выполняется настоящий короткий сценарий, появляется MP4 и отчёт, а файлы захвата и речи имеют реальные метаданные.
6. Изменение одной реплики повторно создаёт только нужное аудио и монтаж, без лишней записи сайта.

До выполнения этих шагов говорите «инструкции подключения подготовлены», а не «интеграция полностью проверена». Для нового приватного проекта отдельно определите допустимость отправки кода клиенту модели и текста сервису озвучки. Бесплатная озвучка в проверенных запусках не означает бесплатное использование Codex, Claude или GLM.
