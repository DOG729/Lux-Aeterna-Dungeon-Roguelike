# Сохранения

---

## Расположение

```
save/
├── account.json                    # Кросс-сейв аккаунт (счётчики, ачивки, отношения/память NPC в account-режиме)
├── config.json                     # Глобальные настройки (провайдер, модель, громкость, язык)
├── .session.json                   # Автосохранение текущей сессии (slim-формат)
├── 2026-05-09-11-08-34/           # Именованное сохранение (YYYY-MM-DD-HH-MM-SS)
│   ├── player.json
│   ├── world.json
│   └── journal.json
└── 2026-05-09-12-00-00/
    ├── player.json
    ├── world.json
    └── journal.json
```

Сохранения не удаляются автоматически. Максимальное количество не ограничено.

`account.json` живёт отдельно от `.session.json` и именованных сохранений: это единственный файл, который **не** привязан к конкретному прохождению и переживает `/api/new-game`.

---

## Slim / Hydrate

Перед записью на диск объекты «сжимаются» для компактности:

- **Инвентарь:** `[{ id, count }]` (без name, image, stats и т.д.)
- **Экипировка:** `{ slot: id | null }` (вместо полного объекта предмета)
- **Мобы:** только изменяемые поля (`hp`, `energy`, `abilityCooldowns`, `memory`, `effects`, `triggeredPhases`)
- **NPC:** только изменяемые поля — `messageCount`, `history`, `shop` (id/count/price), `defeated`, `relationship`, `memory`, `recentTrades`, `dreamedUpTo`. Всё остальное (имя, портрет, промпт и т.д.) при гидратации берётся из манифеста NPC заново.

При загрузке объекты «гидрируются» обратно из манифестов (`hydratePlayer`, `hydrateMob`, `hydrateNpc`, `hydrateObject`). Это гарантирует, что обновление манифестов вступает в силу при следующей загрузке сохранения.

`slimNpc`/`hydrateNpc` (`server/engine/session.js`) гарантируют, что `defeated`, `relationship`, `memory`, `recentTrades` и `dreamedUpTo` переживают перезапись `.session.json`, именованные сохранения и смену языка (иначе, например, «побеждённость» NPC незаметно сбросилась бы при следующей гидратации). Подробности о том, что означают эти поля и как считается `relationship`/`memory` — в [npc_combat.md](npc_combat.md). Если у NPC в манифесте задан `relationship.mode: "account"`, при гидратации `relationship`/`memory` подменяются живыми значениями из `save/account.json` (см. ниже) — то, что лежит в slim-снимке сессии для такого NPC, игнорируется.

---

## `config.json`

```json
{
  "provider": "ollama",
  "model": "llama3",
  "url": "http://localhost:11434",
  "openrouterKey": "",
  "openrouterModel": "openai/gpt-oss-120b:free",
  "ollamaJsonMode": true,
  "openrouterJsonMode": true,
  "bgVolume": 0.25,
  "battleVolume": 0.25,
  "lang": "ru"
}
```

Не удаляется при новой игре. Значения по умолчанию (`CFG_DEFAULTS` в `engine/data.js`) применяются если файл отсутствует или повреждён.

---

## `account.json`

Кросс-сейв аккаунтная статистика — не привязана к конкретной сессии/прохождению, не сбрасывается новой игрой. Управляется модулем `server/engine/account.js`, значения по умолчанию — `DEFAULTS`.

Иллюстративный пример (не дамп реального файла — реальный `save/account.json` в репозитории содержит смок-тестовые данные в `npcMemory`, накопленные при ручном тестировании фичи, и не показателен как образец):

```json
{
  "gamesStarted": 12,
  "totalDefeats": 3,
  "maxFloor": 4,
  "totalKills": 21,
  "totalSpared": 2,
  "totalBossKills": 1,
  "totalNpcMet": 5,
  "npcsMet": ["one_lost", "man_bandages"],
  "achievements": ["point_1", "hp_1"],
  "npcRelationships": {
    "one_lost": -13
  },
  "npcMemory": {
    "one_lost": [
      "На 1 этаже рыцарь одолел меня в бою, и мне пришлось бежать.",
      "Его клинок был холоднее, чем пустота в моей груди."
    ]
  }
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `gamesStarted` | number | Инкрементируется в `trackGameStarted()` при каждом `/api/new-game`. |
| `totalDefeats` | number | Инкрементируется в `trackDefeat()` — один раз за фактическое поражение (HP игрока = 0), независимо от того, что игрок делает дальше (рестарт или загрузка). |
| `maxFloor` | number | Максимальный достигнутый этаж за всё время. `trackFloor(floor)` обновляет только если `floor > maxFloor`. |
| `totalKills` | number | Инкрементируется в `trackKill(mobId)` на каждое убийство моба. |
| `totalBossKills` | number | Дополнительно инкрементируется в `trackKill(mobId)`, если `mobId` есть в `BOSSES`. |
| `totalSpared` | number | Инкрементируется в `trackSpared()` — сколько раз моб был пощажён вместо убийства. |
| `totalNpcMet` | number | Инкрементируется в `trackNpcMet(defId)` на каждое **первое** взаимодействие с экземпляром NPC. |
| `npcsMet` | string[] | Список уникальных `defId` встреченных NPC (без повторов), пополняется в `trackNpcMet`. |
| `achievements` | string[] | Список id полученных ачивок. Выдача — `grantAchievement(id)`, возвращает `true` только если ачивка выдана впервые. |
| `npcRelationships` | `{ [defId]: number }` | Кросс-сейв «отношение» к NPC для тех, у кого в манифесте `relationship.mode: "account"`. Ключ — `defId` NPC (не `instanceId` — общее на всех экземпляров этого типа NPC во всех сохранениях). См. [npc_combat.md](npc_combat.md). |
| `npcMemory` | `{ [defId]: string[] }` | Кросс-сейв компактная «память» NPC — список строк-заметок, общий для `relationship.mode: "account"`. Ограничен по токенам через `NPC_COMBAT_CFG.memory.max_tokens_account` (см. ниже). |

**Функции `server/engine/account.js`, относящиеся к `npcRelationships`/`npcMemory`:**

| Функция | Когда вызывается | Что делает |
|---------|-------------------|------------|
| `getAccountRelationship(defId, dflt = 0)` | Из `hydrateNpc()` в `session.js` и из `npc.js` при спавне NPC с `relationship.mode: "account"` | Возвращает текущее отношение к `defId`; если ключа ещё нет — создаёт его со значением `dflt` (обычно `base.relationship.default` из манифеста NPC). |
| `adjustAccountRelationship(defId, delta)` | Из `npc.js` при исходе боя/диалога с NPC в account-режиме | Прибавляет `delta`, клампит в `[NPC_COMBAT_CFG.relationship.min, .max]`, сохраняет на диск, возвращает новое значение. |
| `getAccountMemory(defId)` | Из `hydrateNpc()` и `npc.js` | Возвращает массив строк памяти для `defId` (или `[]`). |
| `pushAccountMemory(defId, line)` | Из `npc.js` при добавлении новой заметки в память NPC в account-режиме | Добавляет `line` в конец списка, обрезает через `capMemoryTokens` по `NPC_COMBAT_CFG.memory.max_tokens_account`, сохраняет на диск. |
| `estimateTokens(text)` | Внутри `capMemoryTokens` (и используется идентичной логикой в `server/engine/npc.js` для session-режима) | Грубая оценка числа токенов без токенайзера: `ceil(text.length / NPC_COMBAT_CFG.memory.token_char_ratio)`. |
| `capMemoryTokens(list, maxTokens)` | Из `pushAccountMemory` (и из `npc.js` для session-режима) | Удаляет самые старые строки с начала списка, пока суммарная оценка токенов не уложится в `maxTokens`. Мутирует и возвращает `list`. |

`resetAccount()` (вызывается из `POST /api/account/reset` в `server/routes/meta.js`) сбрасывает **все** поля `account.json`, включая `npcRelationships` и `npcMemory`, обратно к `DEFAULTS`.

Подробное объяснение семантики `relationship`/`memory`, режимов `session`/`account` и `dream_ai` — в [npc_combat.md](npc_combat.md). Здесь описана только форма хранения.

---

## `player.json` (slim-формат)

```json
{
  "level": 2,
  "xp": 120,
  "gold": 15,
  "charLevel": 2,
  "skillPoints": 1,
  "hp": 75,
  "maxHp": 100,
  "energy": 100,
  "maxEnergy": 100,
  "abilityCooldowns": { "bt_p1": 0 },
  "critChance": 0.05,
  "critMultiplier": 0.3,
  "stats": { "armor": 0, "avoidance": 0.1, "power": 2, "physique": 1, "agility": 0, "intelligence": 0 },
  "bonuses": { "ability:attack:int": 14, "stats:power:int": 2 },
  "levelBonuses": { "stats:power:int": 1 },
  "learnedSkills": ["bt_p1", "bt_n1"],
  "kills": 3,
  "peacefulWins": 1,
  "mobsEncountered": 5,
  "magicUsed": 0,
  "storyFlags": { "_event_fired:intro": true },
  "deadNpcIds": ["one_lost"],
  "inventory": [
    { "id": "elixir_healing", "count": 2 }
  ],
  "equip": {
    "weapon": "sword_iron",
    "shield": null,
    "amulet": null,
    "ring": null
  }
}
```

**Примечания:**
- `level` — уровень подземелья (≠ уровень персонажа). Уровень персонажа — `charLevel`.
- `stats`, `bonuses`, `maxHp`, `maxEnergy`, `critChance`, `critMultiplier` — пересчитываются через `recalcStats()` при загрузке. В файл записываются как есть, но не являются авторитетными — при загрузке всегда пересчитываются заново.
- `levelBonuses` — накопленный словарь grants от повышения уровней (`{ "stats:power:int": 1, ... }`). Участвует в `recalcStats()`.
- `abilityCooldowns` — словарь `{ abilityId: ходов_до_готовности }`, накапливается по мере использования способностей в бою.
- `storyFlags` — плоский словарь флагов сюжета/диалогов/ивентов (`event_engine.js`, `dialogue.js`, условие `storyFlag:key` в `conditions.js`). Ключи и семантика зависят от контента, формат — произвольные `{ key: value }`.
- `magicUsed` — счётчик использований магических способностей (используется условиями/ачивками).
- `deadNpcIds` — **сессионное**, не аккаунтное поле: список `defId` NPC, убитых с `permanent_death: true` (см. [npc_combat.md](npc_combat.md)). Блокирует повторный спавн этих NPC на любом этаже **этой же сессии**. У свежего игрока (`/api/new-game`) этого поля нет — оно не наследуется между сессиями, даже если "убитый навсегда" NPC формально мёртв. Заполняется лениво (`state.session.player.deadNpcIds ?? (... = [])` в `server/routes/combat.js`), поэтому в старых/новых сохранениях может отсутствовать вовсе.
- `inventory` в slim-формате: только `id` и `count`. При гидратации `name`, `image`, `stats`, `use` и т.д. берутся из манифеста предметов.
- `equip` в slim-формате: только строковый id предмета (или `null`). При гидратации заменяется полным объектом из манифеста.

---

## `world.json` (slim-формат)

```json
{
  "level": 2,
  "playerPos": "1,0",
  "hasKey": false,
  "rooms": {
    "0,0": {
      "gid": "0,0", "x": 0, "y": 0,
      "type": "spawn",
      "image": "start_block_[t_b_r].png",
      "preview": "preview/spawn.png",
      "passages": { "left": false, "right": true, "top": true, "bottom": true },
      "objects": [],
      "mob": null,
      "npc": null,
      "discovered": true
    },
    "1,0": {
      "gid": "1,0", "x": 1, "y": 0,
      "type": "key_area",
      "image": "block_[l_b].png",
      "passages": { "left": true, "right": false, "top": false, "bottom": true },
      "objects": [
        { "instanceId": "u3abc", "defId": "key_door1" }
      ],
      "mob": {
        "instanceId": "u5xyz",
        "defId": "skeleton1",
        "level": 2,
        "hp": 20,
        "energy": 70,
        "abilityCooldowns": {},
        "memory": [],
        "effects": null,
        "source": "mob",
        "triggeredPhases": []
      },
      "npc": {
        "instanceId": "u7pqr",
        "defId": "one_lost",
        "messageCount": 3,
        "history": [{ "role": "user", "text": "Кто ты?" }],
        "shop": [{ "id": "elixir_healing", "count": 1, "price": 10 }],
        "defeated": false,
        "relationship": -13,
        "memory": ["На 1 этаже рыцарь одолел меня в бою, и мне пришлось бежать."],
        "recentTrades": [],
        "dreamedUpTo": 3
      },
      "discovered": true
    }
  }
}
```

**Slim mob** — только изменяемые поля. При гидратации `name`, `image`, `promt`, `maxHp`, `maxEnergy`, `abilities`, `stats`, `items` и т.д. берутся из `MOBS`/`BOSSES` по `defId` (`source: "boss"` выбирает `BOSSES`).

**Slim object** — только `instanceId`, `defId` и изменяемые состояния (`opened`, `locked`).

**Slim NPC** — `instanceId`, `defId`, `messageCount`, `history` (лог диалога), `shop` (только `id`/`count`/`price`), плюс npc_combat-состояние: `defeated`, `relationship`, `memory`, `recentTrades`, `dreamedUpTo`. При гидратации имя, портрет, промпт, `narrative_text` и т.д. берутся из `NPCS` по `defId`. Если у NPC манифестный `relationship.mode` — `"account"`, то `relationship` и `memory` при гидратации **подменяются** значениями из `save/account.json` (см. раздел ниже), а значения из slim-снимка мира игнорируются — так что то, что записано здесь в `world.json` для account-режимных NPC, не обязательно совпадает с тем, что реально загрузится. Значения полей и их смысл подробно объяснены в [npc_combat.md](npc_combat.md).

**Типы комнат:**

| `type` | Описание |
|--------|----------|
| `spawn` | Стартовая комната уровня |
| `normal` | Обычная комната |
| `key_area` | Комната с ключом |
| `door_area` | Комната с дверью на следующий уровень |

---

## `journal.json`

Массив записей журнала событий:

```json
[
  { "type": "combat",   "text": "Встретил Скелет (уровень 2)",        "dungeonLevel": 2 },
  { "type": "dialogue", "text": "Вы: \"Сдавайся!\"",                   "dungeonLevel": 2 },
  { "type": "combat",   "text": "Победа над Скелетом. +25 XP",         "dungeonLevel": 2 },
  { "type": "event",    "text": "Уровень 2! +1 SP",                    "dungeonLevel": 2 }
]
```

| `type` | Описание |
|--------|----------|
| `combat` | Начало/конец боя, победа, поражение, побег |
| `dialogue` | Реплики игрока и мобов/NPC в ходе боя |
| `event` | Повышение уровня, переход на этаж, подбор ключа |

Хранится до 1000 записей (старые обрезаются). Передаётся при переходе на следующий уровень подземелья.

---

## Загрузка сохранения

При `POST /api/load`:
1. Читаются `player.json`, `world.json`, `journal.json`.
2. `hydrateSession()` — гидратирует все объекты из манифестов.
3. `recalcStats(player)` — пересчитывает все производные характеристики.
4. `session.combat = null` — бой сбрасывается.

---

## Автосохранение

После каждого изменения состояния (`saveSessionAuto()`) сессия записывается в `save/.session.json` в slim-формате. При перезапуске сервера `GET /api/session` восстанавливает её автоматически.

---

## Добавление новых полей

При добавлении нового поля в `player` или `dungeon` — старые сохранения не содержат этого поля. Код должен использовать `?? defaultValue`:

```js
player.levelBonuses = player.levelBonuses ?? {};
player.learnedSkills = player.learnedSkills ?? [];
player.kills = player.kills ?? 0;
```
