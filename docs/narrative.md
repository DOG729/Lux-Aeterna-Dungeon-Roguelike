# Система нарратива

Опциональный AI-рассказчик, который добавляет атмосферный текст в нескольких точках игры:

| Момент | Где появляется |
|--------|----------------|
| Перед боем | Первое сообщение в чате боя (блокирует кнопки до ответа AI). Если противник — знакомый NPC ([npc_combat](npc_combat.md)), используется отдельная боевая секция NPC, а не `beffore_combat` |
| После победы | Текст в `#go-sub` в модальном окне game-over (`after_combat`) |
| После поражения | Текст в `#go-sub` в модальном окне game-over (`after_defeat`) |
| Встреча с NPC | Первое сообщение в окне диалога NPC |

---

## Главный рубильник

```json
{ "narrative": false }
```

При `narrative: false` вся система отключена — никаких нарративных текстов, никаких запросов к AI.

---

## Файл `assets/config/narrative.json`

```jsonc
{
  "narrative": true,

  "beffore_combat": {
    "active": true,
    "is_ai": true,
    "path_promt_narrator": "assets/translation/{lang}/promts/narrator_combat.md",
    "default": "Неожиданная встреча с {mob_name}.",
    "variants": [
      {
        "key": "narrative_berserk",
        "if": ["condition:berserk"],
        "text": "{mob_name} шагнул из тьмы — и на миг замер.",
        "is_ai": true
      },
      {
        "key": "narrative_wounded",
        "if": [["player:hp", "<", ["player:maxHp", "*", 0.3]]],
        "text": "{mob_name} увидел твои раны и увидел в этом шанс.",
        "is_ai": true
      }
    ]
  },

  "after_combat": {
    "active": true,
    "is_ai": false,
    "path_promt_narrator": "assets/translation/{lang}/promts/narrator_combat.md",
    "default": "{mob_name} испустил последний дух."
  },

  "after_defeat": {
    "active": true,
    "is_ai": false,
    "default": "Вы испустили последний дух…"
  },

  "NPC": {
    "active": true,
    "trader": {
      "active": true,
      "is_ai": true,
      "path_promt_narrator": "assets/translation/{lang}/promts/narrator_npc.md",
      "path_promt_narrator_combat": "assets/translation/{lang}/promts/narrator_npc_combat.md",
      "default": "Вы встретили {npc_name}.",
      "variants": [...]
    },
    "other": {
      "active": true,
      "is_ai": true,
      "path_promt_narrator": "assets/translation/{lang}/promts/narrator_npc.md",
      "path_promt_narrator_combat": "assets/translation/{lang}/promts/narrator_npc_combat.md",
      "default": "Вы встретили {npc_name}.",
      "variants": [...]
    }
  }
}
```

`after_combat` показывается после **победы** (текст о гибели моба), `after_defeat` — после **поражения игрока** (собственный текст, без `{mob_name}`). Оба независимо переключаются `active`/`is_ai`.

---

## Поля секции

| Поле | Тип | Описание |
|------|-----|----------|
| `active` | bool | Включена ли данная секция |
| `is_ai` | bool | Отправлять текст через AI-нарратора или показывать напрямую |
| `path_promt_narrator` | string | Путь к файлу системного промта нарратора; `{lang}` заменяется активным языком |
| `path_promt_narrator_combat` | string | Только у `NPC.trader`/`NPC.other`: промт для случая, когда этот же NPC встречен как **противник** в бою (см. [«Бой с NPC»](#бой-с-npc-npc_trader_combat--npc_other_combat) ниже). Если не задан — используется обычный `path_promt_narrator` |
| `default` | string | Текст по умолчанию (если ни один вариант не подошёл) |
| `variants` | array | Условные варианты текста (см. ниже) |

---

## Варианты (`variants`)

```jsonc
{
  "key":       "narrative_berserk",     // Опционально: ключ в файле перевода
  "if":        ["condition:berserk"],   // Условие (см. resolveTextVariant)
  "text":      "Прямой текст...",       // Fallback если ключ перевода не найден
  "is_ai":     true,                    // Переопределяет is_ai секции для этого варианта
  "priority":  10,                      // Опционально: приоритет среди совпавших вариантов
  "extension": false                    // Опционально: добавить к основному тексту, а не заменять его
}
```

Обрабатывает `resolveTextVariant()` (`public/js/conditions.js`):

1. Проверяются условия `if` всех вариантов; несовпавшие отбрасываются.
2. Среди совпавших **обычных** вариантов (`extension` не задан или `false`) побеждает вариант с наибольшим `priority` (по умолчанию `0`); при равенстве — первый по порядку в массиве. Если совпавших нет — берётся `default`.
3. Совпавшие варианты с `extension: true` не заменяют основной текст, а добавляются к нему через пробел, в порядке убывания `priority`.
4. Итоговый `is_ai` = `is_ai` основного варианта (или `default`-а) ИЛИ `is_ai` любого добавленного расширения.

Формат идентичен тому, что использует `encounter_text` боссов (`priority`/`extension`) — см. [manifests.md](manifests.md#assetsbossmanifestojson--боссы).

---

## Формат условий `if`

Используется клиентский `resolveTextVariant()` из `public/js/conditions.js`.

```js
// Одно условие — строка-ссылка
["condition:berserk"]

// Сравнение
[["player:hp", "<", ["player:maxHp", "*", 0.3]]]

// AND — все должны быть true
["condition:berserk", ["player:hp", "<", 50]]
```

Пути `player:hp`, `player:maxHp` — обращаются к `state.G.player`. `condition:berserk` — встроенное условие (HP < 15% или energy < 15%).

---

## Переменные в тексте

| Переменная | Значение |
|-----------|----------|
| `{mob_name}` | Имя моба (в `beffore_combat` и `after_combat`) |
| `{npc_name}` | Имя NPC (в секциях `NPC`) |

---

## Загрузка промта нарратора (`path_promt_narrator`)

Функция `loadNarratorPrompt(pathTemplate)` в `server/engine/ai.js`:

1. Подставляет активный язык (`cfg.lang`) вместо `{lang}`.
2. Если файл существует — читает его.
3. Если нет — подставляет `CORE_LANG` (язык из `translation.json`).
4. Если и этого файла нет — возвращает `null`, AI-запрос всё равно выполняется с дефолтным промтом.

Пример пути: `assets/translation/ru/promts/narrator_combat.md`

---

## Промты нарратора

Хранятся в `assets/translation/{lang}/promts/`. По соглашению:

| Файл | Используется для |
|------|-----------------|
| `narrator_combat.md` | `beffore_combat` и `after_combat` |
| `narrator_npc.md` | Секции `NPC.trader` и `NPC.other` (обычная встреча) |
| `narrator_npc_combat.md` | Те же секции, но `path_promt_narrator_combat` — когда этот NPC встречен как противник в бою (см. ниже) |

Файл содержит системный промт нарратора — описание его голоса, стиля, фактов мира, которые он должен учитывать.

---

## `encounter_text` у мобов

Моб может переопределить нарративный текст перед боем через поле `encounter_text` в манифесте:

```jsonc
{
  "id": "skeleton1",
  ...
  "encounter_text": {
    "default": "Скелет поднялся из-под земли.",
    "is_ai": true,
    "variants": [
      {
        "key": "encounter_berserk",
        "if": ["condition:berserk"],
        "text": "Скелет почуял кровь и бросился вперёд.",
        "is_ai": true
      }
    ]
  }
}
```

Если у моба есть `encounter_text` — используется оно вместо глобального `beffore_combat`. Иначе — `narrative.beffore_combat` с подстановкой `{mob_name}`.

### Мультиязычность: ключ `encounter_default`

При `encounter_text.default` также проверяется ключ `encounter_default` в файле перевода моба (`assets/translation/{lang}/mob/{mobId}.json`). Если ключ найден — используется перевод. Если нет — используется текст из манифеста напрямую.

```json
// assets/translation/ru/mob/skeleton1.json
{
  "name": "Скелет (новичок)",
  "encounter_default": "Кости гремели в тишине — и вдруг ожили."
}
```

Аналогично для вариантов: ключ `v.key` ищется в том же файле перевода.

---

## Бой с NPC (`npc_trader_combat` / `npc_other_combat`)

Если моб в бою пришёл не из `mob/manifesto.json`, а является боевым NPC (`sourceNpc` на объекте моба — см. [npc_combat.md](npc_combat.md)), нарратор перед боем берёт не `narrative.beffore_combat`, а `narrative.NPC.trader`/`.other` — тот же спек, что и для обычной встречи с этим NPC, но с боевым промтом.

- Клиент (`_showNarration()` в `public/js/combat.js`) при `mob.sourceNpc` выбирает секцию `narrative.NPC.trader` или `.other` (по `npcSrc.npcType`) вместо `beffore_combat` **и игнорирует** `encounter_text` самого мобa-шаблона — для NPC-боя всегда используется NPC-секция.
- В запросе `POST /api/narrate` при этом передаётся `section: "npc_trader_combat"` или `"npc_other_combat"` (а не `"npc_trader"`/`"npc_other"`, которые используются при обычном открытии диалога NPC).
- На сервере (`sectionMap` в `POST /api/narrate`, `server/routes/combat.js`) все четыре ключа резолвятся в один и тот же объект секции:

  ```js
  const sectionMap = {
    after_combat, after_defeat,
    npc_trader:        NARRATIVE.NPC?.trader,
    npc_other:         NARRATIVE.NPC?.other,
    npc_trader_combat: NARRATIVE.NPC?.trader,   // тот же объект секции,
    npc_other_combat:  NARRATIVE.NPC?.other,    // просто другой системный промт
  };
  ```

- Флаг `isNpcCombat` (`sectionKey === 'npc_trader_combat' || 'npc_other_combat'`) решает, какой файл промта грузить: `sectionCfg.path_promt_narrator_combat`, если задан, иначе — обычный `path_promt_narrator` секции (fallback).

Итого: для одного и того же NPC можно завести отдельный «боевой» голос нарратора (`path_promt_narrator_combat`), не трогая текст/условия `variants` — они общие для мирной встречи и для боя, меняется только системный промт.

---

## Поведение клиента

### `beffore_combat` (`is_ai: true`)

1. `enterCombat()` → `_showNarration()`.
2. Все кнопки боя заблокированы (`state.busy = true`).
3. В чат добавляется плейсхолдер `«…»` с классом `npc-chat-thinking`.
4. Обычный моб: `POST /api/narrate { text }` — поле `section` не передаётся, сервер сам подставляет `beffore_combat` (см. [«Эндпоинт»](#эндпоинт-post-apinarrate) ниже). Бой со знакомым NPC: `section: "npc_trader_combat"` / `"npc_other_combat"` (см. [«Бой с NPC»](#бой-с-npc-npc_trader_combat--npc_other_combat) выше).
5. Ответ заменяет плейсхолдер, кнопки разблокируются.

### `after_combat` / `after_defeat`

Обе показываются в `_showAfterCombatNarration(prevMob, sectionKey)` → пишут текст в `#go-sub` модала game-over. При `is_ai: true` — сначала `«…»`, потом ответ AI.

| Исход боя | `handleCombatEnd(result, ...)` | Секция |
|---|---|---|
| Победа / добивание (`"victory"` / `"kill"`) | вызывает `_showAfterCombatNarration(prevMob, "after_combat")` | `after_combat` — текст о гибели **моба** |
| Поражение игрока (`else`-ветка) | вызывает `_showAfterCombatNarration(prevMob, "after_defeat")` | `after_defeat` — текст о гибели **игрока** |
| Пощада / сдача (`"surrender"` / `"spare"`) | нарратив **не вызывается** | — |

### `NPC`

1. `openNpc()` → `_showNpcNarration(npc)`.
2. Нарратив добавляется первым сообщением в `#npc-chat-log`.
3. `section` в запросе: `"npc_trader"` или `"npc_other"` в зависимости от `npc.type`.

---

## Эндпоинт `POST /api/narrate`

| Поле | Тип | Описание |
|------|-----|----------|
| `text` | string | Исходный шаблонный текст для обработки нарратором |
| `section` | string | Ключ секции: `"after_combat"`, `"after_defeat"`, `"npc_trader"`, `"npc_other"`, `"npc_trader_combat"`, `"npc_other_combat"`; не передан/неизвестен → `beffore_combat` (см. `sectionMap` в `server/routes/combat.js`) |

**Ответ:** `{ "text": "Атмосферный текст нарратора..." }`

Если `narrative: false` в конфиге — возвращает `{ "text": <исходный text> }` без AI.

---

## Сценарный диалог (отдельно от AI-нарратора)

Два разных механизма:

| | AI-нарратор (`narrative.json`) | Сценарный диалог (`dialogue.json`) |
|--|-------------------------------|-----------------------------------|
| Когда | Перед/после боя, при открытии NPC | По событию, квесту, в [scavenge](scavenge.md) |
| API | `POST /api/narrate` | `POST /api/dialogue/start`, `advance`, `close` |
| Движок | `ai.js` + шаблоны/variants | `server/engine/dialogue.js` |
| Клиент | `combat.js`, `npc.js` | `dialogue.js` (через `event.js`) |

События из `event.json` могут запускать диалог action `{ "dialogue": "id" }` — см. [api.md](api.md#события-eventjson).
