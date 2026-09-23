# Understand the product before recording

Read source before driving a local product. Start with repository instructions, README, dependency manifest and start scripts. Locate the requested route and follow the relevant component, event handler, state/store and API or persistence code. Read enough surrounding lines to understand preconditions, authorization, loading/error states and the success result. Do not ingest the entire repository or open `.env`, secret stores, auth profiles or user uploads.

Write a short product explanation: who uses it, what problem it solves, and the specific outcome this video will demonstrate. Link every planned interaction and claim to source evidence with file path, line range and checked content hash. A button label alone does not prove what an action does. A source implementation alone does not prove the running instance reached its result.

Use the installed `analyze --help` to inspect the current understanding contract. The project manifest is `demo.understanding.json`. The analyzer can expose bounded source evidence and produce a draft; it cannot infer product meaning for the agent. Fill the product and flow fields after reading the actual code, then use `analyze --validate`. Do not change `draft` to `ready` while leaving placeholders or unverifiable claims. Stale source hashes or changed flow/start settings require revisiting the affected evidence before validation.

Start a draft with `analyze --project <absolute-project> --config <config-path> --source <relative-source-file>`; repeat `--source` for additional files. The CLI returns bounded source excerpts under `readings` and records their evidence IDs. Read these excerpts and any necessary surrounding source. It intentionally refuses to overwrite an existing manifest. `--dry-run` can return a fresh draft/readings without replacing reviewed reasoning. `--analysis <relative-json-path>` selects an alternative manifest inside the project; keep it consistent across analyze/capture/all.

The manifest contains `product.name/purpose/audience/primaryOutcome`; `safeStart` mirrors the reviewed command/arguments or an existing server and explains why it is appropriate. `flow` entries require a unique `id` and map zero-based `actionIndexes` to an authored summary, `evidenceIds` and a visible `success` description/locator. Every non-artistic action needs a flow explanation; code mode needs implementation-source references, not only README text. Preserve generated `binding.configSha256`, `sourceEvidence.fileSha256` and `excerptSha256` for unchanged inputs. Set `authoredBy`, `reviewedAt` and `status: "ready"` only after review. A structural pass still reports `semanticUnderstandingVerified: false`: meaning remains the agent's responsibility.

Before recording, perform a read-only UI check with capture and tracing off. Confirm that the intended route loads, the expected labels and controls exist, and the initial state is suitable. Do not click save/delete/send or otherwise change business data during this check. If login is needed, follow the separate unrecorded auth handoff. Use fixture/staging data for the subsequent authorized demonstration.

For every planned action establish: relevant code, initial condition, unique semantic locator, effect, observable ready/success condition and the narration it supports. Use readiness checks instead of arbitrary repeated waits. If source and UI disagree, diagnose the wrong route, stale build, feature flag, permissions or fixture before capturing. Record the discrepancy rather than inventing a successful product state.

When only a URL is supplied and source is unavailable, state that constraint and use the explicit URL-only manifest mode with its reason and observed UI evidence. Restrict claims to what can be demonstrated. This is a documented limit, not source-code understanding. Do not use it as a shortcut when the repository is available.

Capture and the first expensive render enforce the understanding gate. Keep the reviewed manifest with the run. The validated manifest is evidence of the planning process; technical validation cannot establish that the product explanation is correct, so the agent must review it.

For a failed stage, inspect the precise error and relevant input. Make at most two targeted repair cycles for the same issue, retaining the failure log. Re-run narration only for changed speech; re-plan for changed framing/timing; re-render and inspect only the affected result. Re-capture only if the recorded source is missing, wrong, private, stale, or cannot show the requested action. After the repair budget is exhausted, stop repetitive attempts and report the root cause, preserved artifacts and smallest missing decision or environment change. Do not bypass the ledger with cosmetic edits or a new output folder.

The runtime ledger lives at `logs/attempt-ledger.json` inside the run. Its default limits are two failed/abandoned attempts for the same stage/input and four for the stage across the run. Successful or cached runs do not spend this failure budget. These implementation limits supplement the agent's two-repair discipline; they are not permission to keep cycling through different inputs without understanding a defect.


## Точный формат авторских полей

Сохраните созданные `binding` и `sourceEvidence` из черновика. Следующий фрагмент показывает **форму**, а не готовое свидетельство вашего продукта. Названия, индексы действий, локаторы и ссылки замените результатом чтения настоящего кода. У каждого элемента `flow` обязателен уникальный ASCII `id`.

```json
{
  "authoredBy": "Codex",
  "product": {
    "name": "Форма",
    "purpose": "Пользователь собирает подборки материалов и сохраняет их в библиотеке.",
    "audience": "Автор материалов и его команда",
    "primaryOutcome": "Новая подборка с выбранным названием появляется в библиотеке."
  },
  "flow": [{
    "id": "save-collection",
    "summary": "Заполнить название подборки, сохранить и дождаться новой карточки в библиотеке.",
    "actionIndexes": [0, 1, 2],
    "evidenceIds": ["source-001"],
    "success": {
      "description": "Сохранённая подборка видима в библиотеке после обработки кнопки.",
      "locator": {"testid": "saved-collection"}
    }
  }],
  "uiEvidence": []
}
```

В режиме code `uiEvidence` допустимо оставить пустым: отдельную проверку живого интерфейса всё равно проводит агент и сохраняет её результат. Для URL-only массив обязателен. Если добавляете UI-свидетельство в любом режиме, требуется полный формат:

```json
{
  "id": "ready-page",
  "url": "http://127.0.0.1:4174/",
  "observedAt": "2026-09-23T12:00:00.000Z",
  "locator": {"testid": "dashboard"},
  "observation": "После загрузки виден список подборок и доступна кнопка создания.",
  "artifact": {"path": "observations/ready-page.json", "sha256": "ACTUAL_SHA256_OF_RECEIPT_BYTES"}
}
```

Файл `artifact.path` — локальный JSON с полями `schemaVersion: 1`, `kind: "product-demo-ui-observation"`, `visible: true` и точно такими же `url`, `observedAt`, `locator`, `observation`. Он фиксирует **реально выполненное** наблюдение, не имитирует его. Вычислите SHA-256 байтов этого файла; не подставляйте хеш текста, скриншота или другой сериализации. Дата должна соответствовать настоящему наблюдению. Не добавляйте в receipt содержимое полей входа или секреты.

При `analysis_schema_invalid` версия0.4 выводит конкретные пути, например `analysis_field:flow.0.id:invalid_type:expected-string`. Исправляйте указанное поле по контракту. Не удаляйте содержательные проверки ради обхода ошибки и не подбирайте случайные варианты JSON. `analyze --validate` не запускает capture и не расходует бюджет попыток записи.
