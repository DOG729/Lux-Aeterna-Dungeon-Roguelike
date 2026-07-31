# Система событий (`assets/event/*.json`)

События связывают игровые триггеры с цепочками действий (видео, диалог, звук, флаги). Клиент получает список action-объектов и воспроизводит их последовательно через `fireEvent()` в `public/js/event.js`.

Сами события лежат в `assets/event/*.json`, список файлов — `assets/event/manifesto.json` (split-формат, как у `assets/dialogue/manifesto.json`: массив имён файлов, каждый — словарь событий по `id`). `assets/config/event.json` — только справочная документация формата, рантайм её не читает.

---

## Структура файла

```jsonc
{
  "event_id": {
    "_comment": "Описание для людей",
    "once": true,          // true = выполняется один раз за сессию (default: false)
    "once_account": true,  // true = один раз НАВСЕГДА, кросс-сейв (save/account.json). Можно сочетать с once.
    "actions": [ ... ]
  }
}
```

`once` сбрасывается при новой сессии/игре (хранится в памяти сервера). `once_account` переживает рестарт сервера и новую игру — сбрасывается только полным сбросом аккаунта.

---

## Типы действий (`actions[]`)

Каждый action — объект с необязательным полем `if` и одним из типов ниже.

### `video`
Воспроизвести полноэкранный ролик.
```jsonc
{ "if": [], "video": "cutscene_intro" }
```
Значение — ключ из `assets/config/media.json → video`.

---

### `dialogue`
Запустить сценарный диалог.
```jsonc
{ "dialogue": "merchant_intro" }
```
Значение — id диалога из `assets/config/dialogue.json`. Клиент вызывает `startDialogueUI(id)` и ждёт завершения.

---

### `sound`
Воспроизвести звук (one-shot).
```jsonc
{ "sound": "event_sting" }
```
Значение — ключ из `media.json → sound`.

---

### `music`
Сменить фоновую музыку. `null` — остановить.
```jsonc
{ "music": "music_boss_tension" }
{ "music": null }
```
Значение — ключ из `media.json → music`.

---

### `narrator`
Текстовый оверлей без полноценного диалога.
```jsonc
{
  "narrator": {
    "text":     "За дверью — тишина другого качества.",
    "text_key": "narrator.fatum_door.approach",
    "skippable": true
  }
}
```
`text_key` — ключ в файле переводов. Если не найден — используется `text`.

---

### `set`
Выставить флаги/переменные сессии.
```jsonc
{ "set": { "storyFlag:seen_intro": true, "storyFlag:karma": "good" } }
```
Пространства имён:
- `storyFlag:key` — сохраняется в `session.player.storyFlags`
- `session:player:key` — прямой путь к полю игрока

---

### `event`
Вызвать другое событие (цепочка/переиспользование).
```jsonc
{ "event": "chained_event_id" }
```

---

## Условия (`if`)

Поле `if` — массив условий. Пустой массив `[]` = всегда выполняется.

```jsonc
{ "if": ["condition:karma_good", "!storyFlag:boss_met"], "dialogue": "karma_path" }
```

**Операторы сравнения:**
```jsonc
["player:hp", "<", 30]
["player:hp", "<", ["player:maxHp", "*", 0.3]]
["player:kills", ">=", 10]
```

**Готовые условия (`condition:*`):**

| Ключ | Условие |
|------|---------|
| `condition:berserk` | Активен статус берсерка |
| `condition:karma_good` | Мирные победы > убийства |
| `condition:karma_bad` | Убийства > мирных побед |
| `condition:used_magic` | Магия использовалась хотя бы раз |

**Переменные сессии:**

| Ключ | Значение |
|------|----------|
| `player:hp` | Текущее HP |
| `player:maxHp` | Максимальное HP |
| `player:floor` | Этаж подземелья |
| `session:player:kills` | Убийств |
| `session:player:peacefulWins` | Мирных побед |
| `session:player:mobsEncountered` | Встреченных мобов |
| `session:player:magicUsed` | Раз применена магия |
| `storyFlag:key` | Пользовательский флаг |
| `account:totalKills` | Суммарные убийства по аккаунту |

**Отрицание:** префикс `!`:
```jsonc
{ "if": ["!condition:used_magic", "storyFlag:fate_accepted"], ... }
```

---

## `select` — взаимоисключающий выбор

```jsonc
{
  "select": [
    { "if": ["condition:karma_good"], "video": "ending_liberation" },
    { "if": ["condition:karma_bad"],  "video": "ending_merge" },
    { "if": [],                        "video": "ending_neutral" }
  ]
}
```

Первый элемент с подходящим `if` выполняется — остальные пропускаются. Без `select` каждый action проверяется независимо.

---

## Хуки — где вешать события

События привязываются к объектам через поле `events` в их манифесте:

```jsonc
// В npc/manifesto.json
{
  "id": "merchant",
  "events": {
    "on_first_encounter": "merchant_first_meet",
    "on_encounter":       "merchant_open"
  }
}
```

| Хук | Когда срабатывает |
|-----|-------------------|
| `on_encounter` | Каждый контакт с объектом (NPC/моб/босс) |
| `on_first_encounter` | Только самый первый раз |
| `on_target` | Игрок прицелился / выбрал объект |
| `on_phase_change` | Смена фазы (боссы) |
| `on_death` | Смерть объекта |
| `on_dialogue_end` | После завершения диалога |
| `on_interact` | Взаимодействие (двери, предметы, рычаги) |
| `on_room_enter` | Игрок вошёл в комнату/зону |
| `on_room_first_enter` | Только при первом входе |
| `on_item_pickup` | Подбор предмета |

---

## Хуки на комнатах (level_plan)

В файлах `assets/level_plan/*.json` каждая комната может иметь поле `events`:

```jsonc
"0,3": {
  "type": "normal",
  "sectionId": "cross_variant",
  "passages": { ... },
  "events": {
    "on_room_enter":       "floor1_cross_enter",
    "on_room_first_enter": "floor1_cross_first"
  }
}
```

Редактируется в **Map Editor** → Inspector → «События комнаты».

---

## Пример: цепочка дверь → босс

```jsonc
// door объект в manifesto.json
{ "on_interact": "boss_door_open" }

// boss в manifesto.json
{ "on_encounter": "boss_encounter", "on_death": "boss_death" }

// event.json
"boss_door_open": {
  "once": true,
  "actions": [
    { "sound": "sound_door_heavy" },
    { "music": "music_boss_approach" },
    { "narrator": { "text": "За дверью что-то ждёт.", "skippable": true } },
    { "event": "boss_encounter" }
  ]
},
"boss_encounter": {
  "once": true,
  "actions": [
    { "music": "music_boss_fight" },
    { "select": [
      { "if": ["condition:karma_good"], "video": "boss_cutscene_good" },
      { "if": [],                        "video": "boss_cutscene_neutral" }
    ]},
    { "dialogue": "boss_intro_dialogue" }
  ]
},
"boss_death": {
  "once": true,
  "actions": [
    { "music": null },
    { "set": { "storyFlag:boss_defeated": true } },
    { "video": "boss_death_cutscene" }
  ]
}
```

---

## API

`POST /api/event/fire` — запустить событие по id.

**Тело:** `{ "eventId": "event_id" }`

**Ответ:**
```json
{
  "alreadyFired": false,
  "actions": [
    { "type": "sound",    "value": "event_sting" },
    { "type": "dialogue", "value": "intro_merchant" }
  ]
}
```

Если `once: true` и уже выполнялось в этой сессии, или `once_account: true` и уже выполнялось когда-либо (кросс-сейв): `{ "alreadyFired": true, "actions": [] }`.

Клиент (`event.js → fireEvent()`) получает массив actions и воспроизводит их последовательно.
