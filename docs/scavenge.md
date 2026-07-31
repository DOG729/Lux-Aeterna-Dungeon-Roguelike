# Система обыска (scavenge)

Полноэкранный интерактивный осмотр комнаты: панорама с кликабельными зонами, задачи, условные скрипты, выход с условиями. Логика на сервере (`server/routes/scavenge.js`), UI — `public/js/scavenge.js`.

---

## Включение

В `assets/config/core.json`:

```json
{ "scavenge_system": { "active": true } }
```

При `active: false` генератор не вешает `room.scavenge`, API возвращает `403`.

---

## Файлы и загрузка

| Путь | Назначение |
|------|------------|
| `assets/scavenge/scenes/<id>.json` | Описание сцены |
| `assets/scavenge/scenes/<image>` | Фон (`start_room.jpg`) |
| `assets/scavenge/<path>` | Спрайты (`objects/…`) |
| `assets/translation/{lang}/scavenge.json` | Переводы (namespace `scavenge`) |
| `assets/config/media.json → sound` | Ключи звуков сцены |

При старте сервера `data.js` читает все `*.json` из `assets/scavenge/scenes/` в `SCAVENGE[id]`.

---

## Привязка к комнате

В секции `assets/map/manifesto.json`:

| Поле | Описание |
|------|----------|
| `scavenge_scene` | ID сцены из `SCAVENGE` |
| `chance_scavenge` | Вероятность 0–1 (по умолчанию `1`) |
| `scavenge_auto_open` | Открыть при входе автоматически |
| `scavenge_repeat_open` | Зарезервировано |

Генератор (`dungeon.js → _buildScavengeState`) при создании комнаты добавляет:

```json
{
  "scavenge": {
    "scene":          "start_room",
    "autoOpen":       false,
    "repeatOpen":     true,
    "removedObjects": [],
    "usedObjects":    [],
    "completedTasks": [],
    "activatedTasks": [],
    "currentImage":   null,
    "visited":        false
  }
}
```

| Поле state | Описание |
|------------|----------|
| `removedObjects` | Объекты, исчезнувшие со сцены (взятые/убранные) |
| `usedObjects` | Объекты, с которыми выполнено `use`-взаимодействие |
| `completedTasks` | Выполненные задачи |
| `activatedTasks` | Явно активированные задачи (`activate` в `use`/`script`) |
| `currentImage` | Подменённый фон сцены (`scene_change`) |
| `visited` | `true` после первого успешного выхода |

---

## Формат сцены (`scenes/<id>.json`)

```jsonc
{
  "id":        "boss_antechamber",
  "image":     "boss_antechamber.jpg",
  "help_text": "Дверь заперта. Нужно найти способ.",
  "sound":     "sound_key",   // ключ media.json или "path/to.mp3"

  "tasks": { /* см. ниже */ },
  "script": [ /* см. ниже */ ],
  "objects": [ /* см. ниже */ ]
}
```

---

## Объекты `objects[]`

Координаты `x`, `y`, `w`, `h` — в пикселях исходного фона; клиент масштабирует по высоте viewport.

| `type` | Поведение по умолчанию |
|--------|----------------------|
| `examine` | Показывает текст при клике |
| `item` | Берётся в инвентарь; `remove: true` убирает зону |
| `exit` | Выход из scavenge с условиями |
| `npc` | Открывает диалог NPC комнаты |

### Общие поля объекта

```jsonc
{
  "id":                    "door_lock",
  "type":                  "examine",
  "x": 500, "y": 300,
  "w": 120,  "h": 150,

  // условие видимости объекта (см. events.md#условия-if); проверяется на каждый
  // GET /api/scavenge/scene, не хранится в state — объект просто не попадает в ответ
  "if":                    [["storyFlag:door_lock_seen"]],

  // текст всплывающей подсказки при наведении (клиент показывает в #scavenge-hint)
  "hint":                  "Похоже, здесь что-то есть",

  // текст при обычном клике (interact)
  "text":                  "Замок выглядит старым.",
  "text_key":              "scavenge.boss_antechamber.lock_text",

  // меняет фон сцены при обычном interact (без .jpg)
  "scene_change":          "antechamber_variant",

  // поле use — см. отдельный раздел
  "use": { ... }
}
```

`hint` разрешается так же как текст: `t('scavenge', scene.id, obj.id + '_hint', obj.hint)`; сервер отдаёт готовую карту `{ objectId: text }` в поле `hints` ответа `GET /api/scavenge/scene`.

### Поля типа `item`

```jsonc
{
  "image":        "objects/sword.png",  // спрайт предмета
  "chance":       0.8,                  // зарезервировано
  "remove":       true,                 // убрать зону после клика
  "add_item":     ["iron_sword"],       // добавить в инвентарь
  "scene_change": "room_without_sword"
}
```

### Поля типа `exit`

```jsonc
{
  "condition": {
    "required_removed": ["door_lock"],   // объекты должны быть убраны
    "required_use":     ["boss_door"]    // объекты должны быть use-нуты
  },
  "condition_fail_text":     "Дверь ещё заперта.",
  "condition_fail_text_key": "scavenge.room.door_locked"
}
```

---

## Поле `use` — взаимодействие

Присутствует на `examine` или `item`. Отделено от обычного клика: клиент вызывает `POST /api/scavenge/use`. Полностью data-driven, без хардкода.

```jsonc
{
  "use": {
    // ── Условия (все должны пройти) ──────────────────────
    "if":              [],                // evalAll — storyFlag, player:hp, account:…
    "require_item":    ["iron_key"],      // ID предметов в инвентаре игрока
    "require_removed": ["door_barrier"],  // эти объекты сцены должны быть убраны
    "require_used":    ["lever"],         // эти объекты должны быть уже use-нуты

    // ── Эффекты при успехе ───────────────────────────────
    "consume_item":    ["iron_key"],      // изъять из инвентаря (1 шт каждый)
    "remove":          ["door_lock"],     // убрать объекты из сцены
    "scene_change":    "door_open",       // подменить фон → "door_open.jpg"
    "complete":        ["task_unlock"],   // пометить задачи выполненными
    "activate":        ["task_enter"],    // активировать скрытые задачи
    "set":             { "storyFlag:door_opened": true },
    "sound":           "sfx_click",       // ID звука (вернётся клиенту)
    "event":           "boss_encounter",  // event ID (клиент вызовет fireEvent)
    "grant_achievement": "found_secret",  // выдаёт ачивку (см. achievements.md), только в /interact

    // ── Текст ────────────────────────────────────────────
    "text":            "Замок щёлкнул и упал.",
    "text_key":        "scavenge.room.lock_open",
    "fail_text":       "У вас нет ключа.",
    "fail_text_key":   "scavenge.room.need_key"
  }
}
```

### Условия `if`

Те же что в `event.json` — см. [events.md](events.md#условия-if). Примеры:

```jsonc
"if": [["player:hp", ">", 10]]           // HP > 10
"if": ["storyFlag:got_the_stone"]        // флаг выставлен
"if": ["!storyFlag:door_opened"]         // флаг НЕ выставлен
```

### Ответ при блокировке

```json
{ "blocked": true, "reason": "items", "missing": ["iron_key"], "failText": "У вас нет ключа." }
```

| `reason` | Причина |
|----------|---------|
| `condition` | `if` не прошёл |
| `items` | `require_item` — нет в инвентаре |
| `removed` | `require_removed` — объект ещё есть на сцене |
| `used` | `require_used` — объект ещё не use-нут |

---

## Задачи `tasks`

```jsonc
"tasks": {
  "unlock_door": {
    "text":         "Найти способ открыть замок",
    "text_key":     "scavenge.room.task_unlock",
    "trigger":      "door_lock",    // завершается при interact/use с этим объектом
    "start_active": true            // видна сразу (по умолчанию true)
  },
  "open_door": {
    "text":         "Открыть дверь",
    "text_key":     "scavenge.room.task_open",
    "trigger":      "boss_door",
    "start_active": false,          // скрыта до активации
    "activation":   ["unlock_door"] // активируется после завершения unlock_door
  }
}
```

| Поле | Описание |
|------|----------|
| `trigger` | `objectId` — задача выполняется при любом взаимодействии с объектом |
| `start_active` | `false` — скрыта до попадания в `activation` или `activate` |
| `activation` | Задачи, которые эта задача **разблокирует** при своём выполнении |

---

## Скрипт `script[]`

Условные правила, применяемые автоматически при загрузке сцены (`GET /api/scavenge/scene`) через `evalAll` + данные сессии.

```jsonc
"script": [
  {
    "if": [
      ["account:gamesStarted", ">=", 2],
      ["account:maxFloor", ">", 1]
    ],
    "remove":   ["sword_wall"],
    "complete": ["find_sword"],
    "activate": ["exit_task"]
  }
]
```

| Поле | Описание |
|------|----------|
| `if` | AND-массив условий (пустой = всегда) |
| `remove` | Убрать объекты из сцены |
| `complete` | Пометить задачи выполненными |
| `activate` | Активировать скрытые задачи |

Используется для «уже решённых» головоломок у опытных игроков или при определённых storyFlag.

---

## Переводы

`assets/translation/{lang}/scavenge.json`:

```json
{
  "boss_antechamber": {
    "help_text":    "...",
    "lock_text":    "...",
    "lock_open":    "...",
    "need_key":     "...",
    "task_unlock":  "..."
  }
}
```

Разрешение на сервере:
- Сцена: `t('scavenge', scene.id, 'help_text', fallback)`
- Задача: `text_key = "scavenge.room.task_unlock"` → ключ `task_unlock` у `scene.id`
- Объект: `t('scavenge', obj.id, 'text', fallback)` (по `obj.id`, не по `scene.id`)

---

## API

### `GET /api/scavenge/scene`

Возвращает сцену текущей комнаты. Перед ответом применяет `script[]`.

**Ответ:**
```json
{
  "scene":      { "id": "...", "objects": [], "tasks": {} },
  "helpText":   "...",
  "soundSrc":   "/assets/sound/...",
  "activeTasks": [{ "id": "unlock_door", "text": "..." }],
  "hints":      { "door_lock": "Похоже, здесь что-то есть" },
  "state": {
    "scene":          "boss_antechamber",
    "removedObjects": [],
    "usedObjects":    [],
    "completedTasks": [],
    "activatedTasks": [],
    "currentImage":   null,
    "visited":        false
  }
}
```

`scene.objects` в ответе — только объекты, чьё поле `if` (см. выше) прошло проверку `evalAll` на момент запроса.

---

### `POST /api/scavenge/interact`

Обычный клик: осмотр, подбор предмета, выход.

**Тело:** `{ "objectId": "sword_wall" }`

**Ответ (examine / item):**
```json
{
  "text":           "Описание объекта",
  "removed":        true,
  "sceneChange":    false,
  "completedTasks": ["find_sword"],
  "activatedTasks": [{ "id": "exit", "text": "..." }],
  "grantedAchievement": { "id": "found_secret", "name": "...", "description": "..." },
  "player":         { ... },
  "npcOpen":        true,
  "npcInstanceId":  "npc_123",
  "state": { ... }
}
```

`grantedAchievement` + `player` появляются только если у объекта сработал `use.grant_achievement` (см. раздел «Поле `use`»); `player` — обновлённый паблик-снапшот игрока (нужен, если ачивка дала статы). `npcOpen`/`npcInstanceId` — только для `type: "npc"`, клиент вызывает `window.openNpc(npcInstanceId)`.

**Ответ (exit — успех):** `{ "exit": true, ...pubSession }`

**Ответ (exit — заблокирован):**
```json
{
  "exit": false,
  "conditionFailed": true,
  "conditionText": "Дверь ещё заперта."
}
```

Условия выхода — `required_removed` И `required_use` (оба проверяются).

---

### `POST /api/scavenge/use`

Намеренное взаимодействие: вставить ключ, активировать рычаг, использовать предмет из инвентаря.

**Тело:** `{ "objectId": "door_lock" }`

**Ответ (успех):**
```json
{
  "ok":            true,
  "text":          "Замок щёлкнул и упал.",
  "sound":         "sfx_click",
  "event":         "boss_encounter",
  "sceneChange":   "boss_antechamber_open.jpg",
  "completedTasks": ["unlock_door"],
  "activatedTasks": [{ "id": "open_door", "text": "..." }],
  "state": { ... }
}
```

**Ответ (заблокирован):**
```json
{
  "blocked":  true,
  "reason":   "items",
  "missing":  ["iron_key"],
  "failText": "У вас нет ключа."
}
```

После получения `event` — клиент вызывает `fireEvent(event)` через существующий `event.js`.  
После получения `sound` — воспроизводит звук через `sfx`.

---

### `POST /api/scavenge/open-event`

Вешает scavenge на текущую комнату из сюжетного события.

**Тело:** `{ "sceneId": "start_room" }`

**Ответ:** `{ "scene": {...}, "state": {...} }`

---

## Пример: дверь с замком

```jsonc
// objects в сцене boss_antechamber
[
  {
    "id": "door_lock", "type": "examine",
    "text": "Замок. Нужен ключ.",
    "use": {
      "require_item":  ["iron_key"],
      "consume_item":  ["iron_key"],
      "remove":        ["door_lock"],
      "sound":         "sfx_click",
      "complete":      ["task_unlock"],
      "text":          "Замок щёлкнул и упал.",
      "fail_text":     "Нужен ключ."
    }
  },
  {
    "id": "boss_door", "type": "examine",
    "text": "Дверь заперта.",
    "use": {
      "require_removed": ["door_lock"],
      "scene_change":    "boss_antechamber_open",
      "sound":           "sfx_door_heavy",
      "event":           "boss_encounter",
      "complete":        ["task_open"],
      "text":            "Дверь со скрипом открывается...",
      "fail_text":       "Сначала нужно убрать замок."
    }
  },
  {
    "id": "exit_to_boss", "type": "exit",
    "condition": {
      "required_use": ["boss_door"]
    },
    "condition_fail_text": "Нужно открыть дверь."
  }
]
```

Поток: **клик на замок** → `use` → проверка key → consume → remove → звук → **клик на дверь** → `use` → проверка removed → scene\_change → звук → event (босс) → **клик на выход** → проверка `required_use` → выход.

---

## Клиент (`public/js/scavenge.js`)

### `openScavenge(sceneData?, roomState?, opts?)`

1. При `opts.zoom` — кинематографичный «наезд» камеры на позицию игрока (см. ниже).
2. Данные с `GET /api/scavenge/scene` или из `state.G` (auto-open).
3. Скрывает карту, показывает `#modal-scavenge`.
4. При `scene.sound` — `music.suspend()`, loop-аудио сцены.
5. Горизонтальный scroll, кликабельные зоны по масштабу `_scale`.
6. Подсказка `helpText` на ~6 с, список задач.

### Анимация «наезда» (`opts.zoom`)

Кнопка «Осмотреться» (`public/js/dungeon.js`) открывает scavenge с `openScavenge(undefined, undefined, { zoom: true })`. Auto-open (см. ниже) вызывает `openScavenge()` без `opts` — молча, без анимации.

Цель — чтобы «наезд» был направлен на реальную клетку игрока на карте подземелья, а не на центр экрана:

1. Ищутся `#dng-map-wrap` (скроллируемый контейнер карты) и `.map-tile.current` (текущий тайл игрока, см. `public/style.css`).
2. Если тайл найден — координаты его центра пересчитываются относительно `#dng-map-wrap` (`tileRect - wrapRect`) и записываются в инлайн-стиль `wrap.style.transformOrigin = "Xpx Ypx"`. Это перекрывает CSS-дефолт `transform-origin: center center` у `.zoom-into-scavenge`.
3. Если тайл не найден — `transformOrigin` явно сбрасывается в `''`, наезд идёт из центра (CSS-дефолт).
4. Вешается класс `zoom-into-scavenge` (`public/style.css`): keyframes `dng-zoom-punch` — `scale(1)→scale(1.18)` с затуханием `opacity` за 320 мс.
5. Клиент ждёт 320 мс (`setTimeout`), снимает класс — только после этого продолжает обычное открытие сцены.
6. Само модальное окно `#modal-scavenge` дополнительно получает класс `zoom-enter` (keyframes `scavenge-zoom-enter`: `scale(1.1)→scale(1)` + fade-in), снимается по `animationend`.

Итог: две последовательные анимации — карта «улетает» в точку игрока (масштаб карты растёт, прозрачность падает), затем поверх неё «влетает» модалка сцены.

### Обработка `use`

Клиент показывает кнопку «Использовать» (или отдельный жест) → `POST /api/scavenge/use` → при `blocked: true` — показывает `failText` → при `ok: true`:
- Обновляет `scene.state`
- Воспроизводит `result.sound` через `sfx`
- Применяет `result.sceneChange` (меняет фон)
- Вызывает `fireEvent(result.event)` если есть

### Auto-open

```js
if (curRoom?.scavenge?.autoOpen && !curRoom.scavenge.visited) openScavenge();
```

---

## Связанные модули

| Модуль | Роль |
|--------|------|
| `server/routes/scavenge.js` | HTTP, условия, use, задачи, script |
| `server/engine/dungeon.js` | `_buildScavengeState` при генерации |
| `server/engine/data.js` | Загрузка `SCAVENGE` |
| `server/engine/conditions.js` | `evalAll`, `applySet` — условия и set в use |
| `server/engine/items.js` | `addToInventory`, `removeFromInventory` |
| `public/js/scavenge.js` | UI клиента |
| `public/js/event.js` | `fireEvent` — для `use.event` |
| `dev/js/scavenge_editor.js` | Визуальный редактор сцен |
