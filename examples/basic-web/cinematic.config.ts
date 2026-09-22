import {fileURLToPath} from 'node:url';
import {defineDemoConfig} from '../../dist/schema.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
export default defineDemoConfig({
 ...{
  "schemaVersion": 1,
  "url": "http://127.0.0.1:4173",
  "allowedOrigins": [
    "http://127.0.0.1:4173"
  ],
  "readyLocator": {
    "testid": "dashboard"
  },
  "viewportCss": {
    "width": 1600,
    "height": 900
  },
  "capturePixels": {
    "width": 2560,
    "height": 1440
  },
  "captureTargetFps": 144,
  "durationSec": 26,
  "language": "ru-RU",
  "voice": "female",
  "ttsProvider": "edge-neural",
  "profile": "web-60",
  "strictNativeFps": false,
  "actions": [
    {
      "type": "pause",
      "ms": 600
    },
    {
      "type": "screenshot",
      "name": "overview"
    },
    {
      "type": "click",
      "locator": {
        "role": "button",
        "name": "＋ Создать проект"
      }
    },
    {
      "type": "fill",
      "locator": {
        "label": "Название проекта"
      },
      "value": "Запуск продукта"
    },
    {
      "type": "pause",
      "ms": 900
    },
    {
      "type": "screenshot",
      "name": "create"
    },
    {
      "type": "click",
      "locator": {
        "role": "button",
        "name": "Создать"
      }
    },
    {
      "type": "waitFor",
      "locator": {
        "testid": "created-project"
      }
    },
    {
      "type": "pause",
      "ms": 1200
    },
    {
      "type": "screenshot",
      "name": "result"
    },
    {
      "type": "pause",
      "ms": 800
    }
  ],
  "storyboard": {
    "schemaVersion": 1,
    "title": "Орбита — место для новой идеи",
    "scenes": [
      {
        "sceneId": "overview",
        "meaning": "Сразу показать продукт и обозначить конкретный результат демонстрации",
        "visibleResult": "Обзор трёх исходных проектов и кнопка создания",
        "displayText": "От идеи\nк проекту",
        "spokenText": "Создадим в Орбите проект для запуска продукта.",
        "eventIds": [
          "event-002"
        ],
        "screenshotId": "overview",
        "sourceKind": "screenshot",
        "layout": "hero",
        "durationSec": 4.2,
        "camera": [
          {
            "at": 0,
            "scale": 1,
            "x": 0.5,
            "y": 0.5
          },
          {
            "at": 1,
            "scale": 1,
            "x": 0.5,
            "y": 0.5
          }
        ]
      },
      {
        "sceneId": "open",
        "meaning": "Связать реальный клик по кнопке с открытием формы",
        "visibleResult": "Форма нового проекта открывается, поле получает введённое имя",
        "displayText": "Понятное начало",
        "spokenText": "Откроем форму нового проекта. Здесь всё просто.",
        "eventIds": [
          "event-003",
          "event-004"
        ],
        "screenshotId": "create",
        "clipId": "clip-001",
        "sourceKind": "video",
        "sourceStartMs": 950,
        "sourceEndMs": 1850,
        "playbackRate": 1,
        "layout": "product",
        "durationSec": 4.2,
        "camera": [
          {
            "at": 0,
            "scale": 1.12,
            "x": 0.65,
            "y": 0.43
          },
          {
            "at": 0.13,
            "scale": 1.2,
            "x": 0.7,
            "y": 0.35
          },
          {
            "at": 0.48,
            "scale": 1.52,
            "x": 0.5,
            "y": 0.5
          },
          {
            "at": 1,
            "scale": 1.52,
            "x": 0.5,
            "y": 0.5
          }
        ]
      },
      {
        "sceneId": "name",
        "meaning": "Дать зрителю прочитать название проекта без имитации печати",
        "visibleResult": "В реальном поле уже введено «Запуск продукта»",
        "displayText": "Дайте идее имя",
        "spokenText": "Дадим проекту имя: «Запуск продукта».",
        "eventIds": [
          "event-004",
          "event-006"
        ],
        "screenshotId": "create",
        "sourceKind": "screenshot",
        "layout": "detail",
        "durationSec": 5.4,
        "camera": [
          {
            "at": 0,
            "scale": 1.52,
            "x": 0.5,
            "y": 0.5
          },
          {
            "at": 1,
            "scale": 1.6,
            "x": 0.5,
            "y": 0.53
          }
        ]
      },
      {
        "sceneId": "submit",
        "meaning": "Показать реальное сохранение с оригинальным ожиданием",
        "visibleResult": "После клика и обработки модальное окно закрывается, появляется новая карточка",
        "displayText": "Проект создаётся",
        "spokenText": "Нажмём «Создать» и дождёмся подтверждения.",
        "eventIds": [
          "event-007",
          "event-008"
        ],
        "screenshotId": "result",
        "clipId": "clip-001",
        "sourceKind": "video",
        "sourceStartMs": 2300,
        "sourceEndMs": 4800,
        "playbackRate": 1,
        "layout": "product",
        "durationSec": 5.4,
        "camera": [
          {
            "at": 0,
            "scale": 1.6,
            "x": 0.5,
            "y": 0.53
          },
          {
            "at": 0.24,
            "scale": 1.6,
            "x": 0.5,
            "y": 0.53
          },
          {
            "at": 0.57,
            "scale": 1.18,
            "x": 0.5,
            "y": 0.56
          },
          {
            "at": 1,
            "scale": 1.24,
            "x": 0.44,
            "y": 0.6
          }
        ]
      },
      {
        "sceneId": "result",
        "meaning": "Завершить крупным планом реального результата, а не обещанием дальнейших функций",
        "visibleResult": "Название «Запуск продукта» и статус «Создан» на новой карточке",
        "displayText": "Проект\nуже в обзоре",
        "spokenText": "Готово! Новый проект уже в обзоре — можно начинать.",
        "eventIds": [
          "event-010"
        ],
        "screenshotId": "result",
        "sourceKind": "screenshot",
        "layout": "outro",
        "durationSec": 6.2,
        "camera": [
          {
            "at": 0,
            "scale": 1.5,
            "x": 0.5,
            "y": 0.56
          },
          {
            "at": 0.68,
            "scale": 1.75,
            "x": 0.45,
            "y": 0.61
          },
          {
            "at": 1,
            "scale": 1.75,
            "x": 0.45,
            "y": 0.61
          }
        ]
      }
    ]
  },
  "brand": {
    "name": "Орбита",
    "accent": "#645de7"
  },
  "allowExternalTts": false,
  "speechRatePercent": 0,
  "presentation": "cinematic",
  "voiceId": "ru-RU-SvetlanaNeural"
},
 project:root,
 start:{command:process.execPath,args:[fileURLToPath(new URL('../server.mjs',import.meta.url)),'--port','4173']}
});
