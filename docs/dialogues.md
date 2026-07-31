# Система диалогов (`assets/config/dialogue.json`)

Сценарные диалоги — пошаговые скрипты с ветвлением, условиями и AI-генерацией реплик. Описываются в `assets/dialogue/*.json` (или прямо в `dialogue.json`), тексты хранятся в `assets/translation/{lang}/dialogue.json`.

---

## Структура диалога

```jsonc
{
  "dialogue_id": {
    "once": true,            // true = запускается один раз, дальше free_chat
    "skippable": true,       // игрок может пропустить кнопкой
    "trigger": "on_encounter",  // подсказка откуда вызывается (не обязательно)
    "lore": "assets/translation/{lang}/promts/lore/one_lost.md", // необязательно — см. "Лор для AI-реплик" ниже
    "entry": [               // стартовый узел — первый подходящий if выигрывает
      { "if": ["storyFlag:met_trader"], "node": "n_repeat" },
      { "if": [],                        "node": "n_start" }
    ],
    "before": { "entry": [...], "script": [ ...nodes ] }, // phase 1: до основного диалога (атмосфера, нарратор)
    "script": [ ...nodes ],  // phase 2: основной диалог (единственная фаза без обёртки — dialogue.script напрямую)
    "outro":  { "entry": [...], "script": [ ...nodes ] }  // phase 3: после боя / завершения (эпилог)
  }
}
```

---

## Структура узла (node)

```jsonc
{
  "id":        "n_start",
  "speaker":   "npc",         // npc | mob | player | narrator
  "text":      "Путник, ты пришёл за помощью?",
  "text_key":  "merchant.intro.greeting",  // ключ перевода (приоритет над text)
  "is_ai":     true,          // true = LLM генерирует реплику на лету
  "ai_hint":   "дружелюбно, с намёком на усталость",  // подсказка LLM
  "narrative": "Торговец поправляет бинты.",  // курсивный текст над репликой
  "next":      "n_choice",    // id следующего узла; null = конец фазы
  "ends_with": "combat",      // terminal-узел: combat | free_chat | shop | close
  "set": { "storyFlag:met_trader": true },  // выставить флаги при достижении узла
  "options": [                // выборы игрока (если есть — next игнорируется)
    {
      "text":      "Мне нужны припасы.",
      "text_key":  "merchant.intro.opt_shop",
      "if":        [],         // условие показа варианта
      "set":       { "storyFlag:wants_shop": true },
      "next":      "n_shop",
      "ends_with": "shop"      // можно на варианте выбора
    },
    {
      "text":      "Я просто проходил мимо.",
      "next":      null,
      "ends_with": "close"
    }
  ]
}
```

### Поля узла

| Поле | Обязательно | Описание |
|------|-------------|----------|
| `id` | Да | Уникальный ID внутри диалога |
| `speaker` | Нет | `npc`, `mob`, `player`, `narrator` (default: `narrator`) |
| `text` | Нет | Статичный текст (fallback) |
| `text_key` | Нет | Ключ в `translation/{lang}/dialogue.json` |
| `is_ai` | Нет | LLM генерирует реплику |
| `ai_hint` | Нет | Подсказка LLM о тоне/содержании |
| `dream_ai` | Нет | Только вместе с `is_ai: true`. `true` — добавляет память NPC (`npc.memory`) как контекст; `{max_change: N}` — плюс AI сам сохраняет новую запись памяти и корректирует `relationship` в пределах `±N`. Требует NPC (не босса) в текущей комнате — см. [npc_combat.md](npc_combat.md#dream_ai--сон-npc) |
| `narrative` | Нет | Серый курсивный текст над речью |
| `next` | Нет | ID следующего узла. `null` = конец фазы |
| `ends_with` | Нет | Конечное значение: `combat`, `free_chat`, `shop`, `close` |
| `set` | Нет | Флаги/переменные, выставляемые при достижении узла |
| `options` | Нет | Варианты выбора игрока |

---

## `ends_with` — что происходит после диалога

| Значение | Поведение клиента |
|----------|-------------------|
| `combat` | Начинается бой с мобом/боссом комнаты |
| `free_chat` | Открывается NPC-чат (свободный разговор) |
| `shop` | Открывается торговля |
| `close` | Диалог закрывается, ничего не происходит |
| `null` | То же, что `close` |

---

## Фазы диалога

1. **`before`** — script-узлы ДО основного диалога. Обычно нарратор, пауза, атмосфера. Игрок не выбирает.
2. **`entry` + `script`** — основной диалог с ветвлениями.
3. **`outro`** — script-узлы ПОСЛЕ (эпилог, нарратор после боя). Вызывается через `on_dialogue_end`.

Видео, музыка до/после — управляются через `event.json` (хуки `on_encounter`, `on_death`, `on_dialogue_end`).

---

## Условия (`if`) в диалогах

Те же что и в `event.json`. Применяются в:
- `entry[].if` — выбор стартового узла
- `options[].if` — условие показа варианта выбора
- Любом месте где можно ветвить

```jsonc
{ "if": ["player:hp", "<", 30] }                       // HP ниже 30
{ "if": ["storyFlag:met_trader"] }                     // флаг выставлен
{ "if": ["!condition:used_magic"] }                    // магия НЕ использовалась
{ "if": ["condition:karma_good", "player:kills", "<", 5] }  // AND-условие
```

**Доступные переменные:**

| Пространство | Пример | Описание |
|-------------|--------|----------|
| `player:` | `player:hp`, `player:maxHp` | Текущие параметры игрока |
| `session:player:` | `session:player:kills` | Статистика сессии |
| `account:` | `account:totalKills` | Статистика аккаунта |
| `condition:` | `condition:berserk` | Готовые составные условия |
| `storyFlag:` | `storyFlag:met_trader` | Сюжетные флаги (через `set`) |

---

## `set` — выставление флагов

В узле или в варианте выбора:
```jsonc
"set": {
  "storyFlag:accepted_quest": true,
  "storyFlag:faction": "merchant"
}
```

Флаги доступны сразу для следующих `if` в том же диалоге и во всех последующих проверках сессии.

---

## Переводы

Тексты диалогов выносятся в `assets/translation/{lang}/dialogue.json`:

```json
{
  "merchant_intro": {
    "greeting":    "Путник! Хорошо, что ты зашёл.",
    "opt_shop":    "Мне нужны припасы.",
    "opt_leave":   "Я просто проходил мимо."
  }
}
```

`text_key` в формате `"namespace.sub.field"` → ищет `dialogue.json["namespace"]["sub"]["field"]`.

---

## AI-реплики

При `is_ai: true` сервер отправляет запрос к LLM с:
- Лором мира (`dialogue.lore`, если задан, иначе общий — см. ниже)
- Полем `ai_hint` как подсказкой о тоне
- Блоком памяти NPC (только если `dream_ai` задан на узле — см. [npc_combat.md](npc_combat.md))
- Историей диалога — что уже было сказано и выбрано в этом диалоге (см. ниже)
- Инструкцией формата ответа на активном языке игры

Если LLM недоступен — используется `text` как fallback.

### Лор для AI-реплик (`dialogue.lore`)

Необязательное поле верхнего уровня диалога. Определяет, какой лор-документ попадает в системный промт каждой AI-реплики этого диалога:

- Не задан — используется общий `assets/translation/{lang}/promts/lore/default.md`.
- Задан (например `"assets/translation/{lang}/promts/lore/one_lost.md"`) — используется **личный** лор-файл этого NPC вместо общего.

Никогда оба сразу — личный лор существует именно для того, чтобы NPC, который сам мало что знает о мире (как Потерянный), не получал на каждую реплику весь пласт лора про церковь и паладинов, который ему не нужен и не должен быть известен.

### История диалога

Каждая уже произнесённая реплика NPC/моба (и статичная, и AI-сгенерированная) и каждый выбранный игроком вариант ответа попадают в `sess.dialogue.history` и передаются модели перед генерацией следующей реплики — так AI не выдумывает реплику с чистого листа, а видит, что сама говорила раньше и что выбирал игрок в этом же разговоре. История сбрасывается при каждом новом запуске диалога и не переносится между разными `dialogue_id`.

---

## Вызов диалога

Диалоги запускаются из событий:
```jsonc
// event.json
{ "dialogue": "merchant_intro" }
```

Или напрямую из кода через `startDialogueUI(dialogueId)` → `POST /api/dialogue/start`.

---

## API

### `POST /api/dialogue/start`
```json
{ "dialogueId": "merchant_intro" }
```
**Ответ:** `{ "node": { "id": "n1", "text": "...", "speaker": "npc", "options": [...] } }`

### `POST /api/dialogue/advance`
```json
{ "choiceIndex": 0 }   // для ветвления
{}                      // для линейного узла
```
**Ответ (продолжение):** `{ "done": false, "node": { ... } }`  
**Ответ (конец):** `{ "done": true, "ends_with": "combat" }`

### `POST /api/dialogue/close`
Аварийное закрытие (ESC). Очищает `session.dialogue`.  
**Ответ:** `{ "ok": true }`

---

## Пример: диалог торговца

```jsonc
"merchant_intro": {
  "once": true,
  "entry": [
    { "if": ["storyFlag:met_merchant_before"], "node": "n_repeat" },
    { "if": [],                                 "node": "n_first" }
  ],
  "before": {
    "script": [
      {
        "id":       "n_narr",
        "speaker":  "narrator",
        "narrative": "Фигура в бинтах поднимает взгляд.",
        "text":     "",
        "next":     null
      }
    ]
  },
  "script": [
    {
      "id":      "n_first",
      "speaker": "npc",
      "text":    "Ты первый, кто добрался сюда за недели.",
      "is_ai":   true,
      "ai_hint": "удивлённо, чуть устало",
      "set":     { "storyFlag:met_merchant_before": true },
      "next":    "n_choice"
    },
    {
      "id":      "n_repeat",
      "speaker": "npc",
      "text":    "Снова ты. Что на этот раз?",
      "is_ai":   true,
      "next":    "n_choice"
    },
    {
      "id":      "n_choice",
      "speaker": "npc",
      "text":    "Чем могу помочь?",
      "options": [
        { "text": "Хочу торговать.",    "ends_with": "shop"  },
        { "text": "Просто поговорим.",  "ends_with": "free_chat" },
        { "text": "Ничего, ухожу.",     "ends_with": "close" }
      ]
    }
  ]
}
```
