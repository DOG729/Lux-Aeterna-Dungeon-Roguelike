# NPC-бои и «сон» (`npc_combat` / `dream_ai`)

Некоторые NPC не только болтают и торгуют, но и дерутся, помнят прошлые встречи и меняют отношение к игроку. Это не отдельная сущность — NPC временно превращается в моба/босса на время боя, используя их же шаблон и движок боя. Дизайн и обоснование решений — в [roadmap/npc_combat.md](../roadmap/npc_combat.md); здесь — как это работает и как этим пользоваться.

---

## Содержание

- [Идея](#идея)
- [Манифест NPC](#манифест-npc)
- [Как начинается бой](#как-начинается-бой)
- [Итог боя (kill / spare / player_defeat)](#итог-боя-kill--spare--player_defeat)
- [`permanent_death` — точная семантика](#permanent_death--точная-семантика)
- [Отношение (`relationship`)](#отношение-relationship)
- [Память (`memory`)](#память-memory)
- [`dream_ai` — «сон» NPC](#dream_ai--сон-npc)
- [Конфиг `assets/config/npc_combat.json`](#конфиг-assetsconfignpc_combatjson)
- [API](#api)
- [Переводы](#переводы)
- [Полный пример: `one_lost`](#полный-пример-one_lost)

---

## Идея

Вместо третьей сущности («NPC-боец» отдельно от мобов и боссов) NPC с `npc_combat: true` **оверлеит** существующий моб- или босс-шаблон:

```
NPC-манифест (relationship, memory, правила боя)
        │
        │  combat.template → mob/boss.manifesto.json
        ▼
  buildMobFromBase() / buildBossFromBase()  +  combat.overrides (deepMerge)
        │
        ▼
   обычный state.session.combat.mob, только с полем sourceNpc
```

Это значит: весь боевой движок (`combat.js`, ходы, AI-реплики моба, дроп, левел-ап) работает без изменений. NPC-специфика — это только: откуда взялся бой, что происходит после победы/поражения, и `sourceNpc` на объекте моба.

---

## Манифест NPC

Поля добавляются прямо в запись `assets/npc/manifesto.json`:

```jsonc
{
  "id": "one_lost",
  // ...обычные поля NPC (name, promt, portrait, type, events...)

  "npc_combat": true,          // включает боевую механику для этого NPC
  "combat": {
    "template": { "source": "mob", "id": "the_undead_thief" }, // источник: "mob" | "boss"
    "overrides": {                                              // deepMerge поверх шаблона
      "name": "Потерянный",
      "hp": 60
    },
    "killable":  true,          // можно добить насмерть
    "spareable": true,          // можно пощадить
    "permanent_death": false,   // см. раздел ниже

    "aggro": "on_sight",                 // "on_sight" | "on_interact" | не указано
    "aggro_relationship_below": -100,    // порог relationship для авто-агро (только on_sight)

    "on_kill":          { "relationship_delta": -2, "memory_key": "...", "event": "..." },
    "on_spare":         { "relationship_delta": 1,  "memory_key": "...", "event": "..." },
    "on_player_defeat":  { "relationship_delta": 0,  "outcome": "...", "text": "...", "text_key": "..." }
  },

  "relationship": { "default": 0, "mode": "account" },  // "session" | "account"
  "dream_ai": { "max_change": 5 }                        // или просто true — см. ниже
}
```

### Поля `combat`

| Поле | Обязательно | Описание |
|------|-------------|----------|
| `template.source` | Да | `"mob"` или `"boss"` — откуда брать боевой шаблон |
| `template.id` | Да | ID записи в `mob/manifesto.json` или `boss/manifesto.json` |
| `overrides` | Нет | Объект, накладываемый на шаблон через `deepMerge` (глубокое слияние, применяется последним) |
| `killable` | Нет (default `true`) | Разрешён добивающий удар |
| `spareable` | Нет (default `true`) | Разрешена пощада |
| `permanent_death` | Нет (default `true`) | См. [ниже](#permanent_death--точная-семантика) |
| `aggro` | Нет | `"on_sight"` — бой начинается при входе в комнату (если `relationship` ниже порога); `"on_interact"` — только кнопкой «Напасть» |
| `aggro_relationship_below` | Нет | Порог `relationship`, ниже которого срабатывает `on_sight` |
| `on_kill` / `on_spare` / `on_player_defeat` | Нет | Что происходит при этом исходе (см. следующий раздел) |

Если `overrides.name` или `overrides.promt` заданы — они переопределяют перевод шаблона: система резолвит их через `t('npc', npcId, 'combat_name'/'combat_promt', overrides.value)`, а не через перевод моба/босса. Это тот самый фикс приоритета перевода — без него `t()` для оригинального моба перекрывал бы патч.

---

## Как начинается бой

Три независимых точки входа — все ведут к `spawnNpcCombat(npc, level, ctx)` в `server/engine/npc.js`:

1. **Кнопка «Напасть» в модалке NPC** (`canAttack` в `pubNpc()` = `npc_combat && !defeated`) → `POST /api/npc/attack`.
2. **Опция в диалоге** с `"ends_with": "combat"` → клиент (`public/js/npc.js`) сам вызывает `attackNpc()` → тот же `/api/npc/attack`.
3. **`aggro: "on_sight"`** — при входе в комнату (`POST /api/move`), если `relationship <= aggro_relationship_below`, бой стартует автоматически, без кнопки.

`spawnNpcCombat` не может начать бой дважды: и `/api/npc/attack`, и `on_sight`-проверка отказывают, если `npc.defeated === true` или NPC уже отсутствует в комнате.

---

## Итог боя (kill / spare / player_defeat)

Обрабатывается в `resolveNpcCombatOutcome(mob, outcomeType, chatLog)` (`server/routes/combat.js`), вызывается из `/api/combat/turn` (победа/поражение) и `/api/combat/mercy` (пощада/добивание).

| `outcomeType` | Когда | Что происходит |
|---|---|---|
| `kill` | Добивающий удар | `relationship += on_kill.relationship_delta` (default из конфига), NPC убирается из комнаты **этого этажа всегда**; если `permanent_death: true` — попадает в `player.deadNpcIds` (блокирует появление на будущих этажах в этой сессии) |
| `spare` | Пощада после победы | `relationship += on_spare.relationship_delta`, `npc.defeated = true` (бой больше недоступен, NPC остаётся на карте как обычный собеседник), опционально `on_spare.event` открывает NPC-модалку сразу |
| `player_defeat` | Игрок проиграл бой NPC | Опциональная `relationship_delta`, специальный «мягкий» game-over (`npcSpecialDefeat`) — игрок не умирает, просто проигрывает стычку и остаётся жив |

После любого исхода, если у NPC задан `dream_ai`, асинхронно (fire-and-forget) вызывается `dreamAboutEncounter()` — см. [ниже](#dream_ai--сон-npc).

---

## `permanent_death` — точная семантика

Это самый частый источник путаницы, поэтому отдельно и явно:

- **Добивание (`kill`) всегда убирает NPC с текущего этажа** — независимо от `permanent_death`. Он не может остаться стоять на карте, если его только что убили.
- `permanent_death: true` — NPC **также** блокируется от появления на **любом следующем этаже в этой же сессии** (пишется в `player.deadNpcIds`, читается фильтром спавна в `dungeon.js`).
- `permanent_death: false` — NPC исчезает только с текущего этажа; на следующих этажах он снова может появиться (как будто «сбежал», а не умер).
- **Новая сессия (`/api/new-game`) не наследует `deadNpcIds`** — он живёт на `player`, который создаётся заново. Даже «перманентно убитый» NPC вернётся в новой игре.

```
kill →  всегда: NPC исчезает с ЭТОГО этажа
        permanent_death:true  → + не появится ни на одном СЛЕДУЮЩЕМ этаже (в этой сессии)
        permanent_death:false → на следующих этажах может появиться снова
        (новая игра — deadNpcIds сбрасывается всегда)
```

---

## Отношение (`relationship`)

Число в диапазоне `[-100, 100]` (границы и дефолтные дельты — в конфиге). Хранится либо в сессии, либо кросс-сейв, в зависимости от `relationship.mode` на NPC:

| `mode` | Где хранится | Функции |
|---|---|---|
| `"session"` (default) | `npc.relationship` в объекте сессии | `adjustNpcRelationship()` меняет напрямую, клэмпит по `min/max` |
| `"account"` | `save/account.json` → `npcRelationships[defId]` | Читается/пишется через `getAccountRelationship()` / `adjustAccountRelationship()`; переживает новую игру и перезапуск |

### Тиры и условие `npc:status`

`assets/config/npc_combat.json`'s `relationship.tiers` превращает число в метку:

| Тир | Диапазон |
|---|---|
| `main_enemy` | -100 … -70 |
| `enemy` | -69 … -25 |
| `neutral` | -24 … 24 |
| `friend` | 25 … 69 |
| `main_friend` | 70 … 100 |

В условиях (`if` в диалогах/событиях/скавенже) доступно:

```jsonc
["npc:status", "is", ["enemy", "main_enemy"]]   // тир входит в список
["npc:status", "is", "friend"]                    // точное совпадение
["!npc:defeated"]                                 // NPC ещё можно атаковать
```

`npc:status` резолвится в `server/engine/conditions.js` для NPC **в текущей комнате игрока**; оператор `is` — единственный, где правая часть НИКОГДА не резолвится как ссылка (это литерал-список меток).

---

## Память (`memory`)

Компактный список коротких строк-воспоминаний NPC об игроке (`npc.memory`), подставляется в системный промт NPC (последние 5 строк) под заголовком «Твои воспоминания об этом человеке». Пишется через `pushNpcMemory()` (готовые ключи перевода, `server.json → npc_memory.*`) или `pushNpcMemoryLine()` (сырая строка — так пишет `dream_ai`).

Бюджет по токенам считается без реального токенайзера — `estimateTokens(text) = ceil(length / token_char_ratio)`; при превышении лимита старые строки отбрасываются с начала списка (`capMemoryTokens`). Лимит и `token_char_ratio` — в конфиге, отдельно для session- и account-режима.

Голый блок памяти сам по себе слабые модели нередко просто игнорируют — поэтому сразу за ним (в `npcSystempromt`, и аналогично в `mobSystempromt` для боевых заметок) идёт явная инструкция «учитывай эти воспоминания в разговоре, пусть они влияют на тон, но не пересказывай их дословно» (`npc_system.memory_instruction` / `mob_system.memory_instruction`). Инструкция добавляется только если память не пуста.

---

## `dream_ai` — «сон» NPC

Асинхронный AI-проход, который «додумывает» короткое личное воспоминание и решает, как чуть-чуть скорректировать отношение — **поверх** фиксированных дельт `on_kill`/`on_spare`/`on_player_defeat`. Работает на двух уровнях.

### 1. Уровень встречи (энкаунтера)

Триггеры — три источника материала для «сна», каждый обновляет `npc.history` / `npc.recentTrades`, а сон резюмирует то, что накопилось:

| Триггер | Где | Что копится |
|---|---|---|
| Разговор | обычный чат с NPC (`/api/npc/message`) | `npc.history` (роли user/assistant) |
| Бой | конец боя, `resolveNpcCombatOutcome` | реальные реплики из `combat.chatLog` + текст исхода |
| Трейд | покупка/продажа (`/api/npc/trade/buy|sell`) | `npc.recentTrades` |

Сон запускается:
- **после боя** — прямо в `resolveNpcCombatOutcome` (не при перманентной смерти в session-режиме — instance всё равно удаляется, писать некуда);
- **при закрытии чата** — `POST /api/npc/close` (клиент вызывает это при закрытии модалки NPC — крестик, клик по фону, ESC).

Дедупликация: `npc.dreamedUpTo` — индекс в `npc.history`, до которого уже «приснилось». При повторном открытии/закрытии чата без новых сообщений (`hasNewDreamMaterial()` вернёт `false`) сон не запускается — AI не вызывается зря, и один и тот же разговор не резюмируется дважды.

Функция всегда fire-and-forget: `dreamAboutEncounter(...).then(saveSessionAuto).catch(() => {})` — не блокирует ответ клиенту.

### 2. Уровень узла диалога (скриптовые реплики)

Работает **только вместе с `is_ai: true`** на узле. Две формы:

```jsonc
{ "is_ai": true, "dream_ai": true }                    // просто контекст
{ "is_ai": true, "dream_ai": { "max_change": 1 } }     // контекст + оценка + сохранение
```

| Форма | Что делает |
|---|---|
| `dream_ai: true` | В системный промт этой конкретной реплики добавляется блок `npc.memory` (последние 5 записей) — реплика становится «осведомлена» о прошлом, но ничего не сохраняет |
| `dream_ai: { "max_change": N }` | То же + просит у AI JSON `{text, memory, relationship_delta}`: `text` — сама реплика, `memory` — новая запись в память (сохраняется сразу), `relationship_delta` — жёстко клэмпится до `±N` и применяется сразу |

Если в текущей комнате нет NPC с `npc_combat`/реальным `defId` (например, диалог привязан к боссу, а не к NPC — боссы лежат в `room.mob`, а не в `room.npc`) — `npc`/`npcDef` резолвятся в `null`, и узел молча падает на обычную генерацию текста без памяти и без сохранения. Ошибок и краша не происходит — это гарантируется структурой кода (`server/engine/dialogue.js`, `_generateText`), а не отдельной проверкой «это босс».

> ⚠️ Важно: `dream_ai` на узле диалога и `dream_ai` на самом NPC-манифесте — это **разные** переключатели. Манифестный `dream_ai` включает энкаунтер-уровень (после чата/боя/трейда); узловой `dream_ai` — точечную оценку конкретной сценарной реплики. Оба вместе можно использовать без конфликта — узловой просто добавляет ещё одно сохранение памяти/дельту к тому, что и так накопится и попадёт в общий «сон» при закрытии чата.

Независимо от `dream_ai`, каждый `is_ai: true` узел диалога получает ещё два источника контекста (подробнее — [dialogues.md](dialogues.md#ai-реплики)):
- **Лор** — личный (`dialogue.lore`) вместо общего, если задан на диалоге.
- **История диалога** (`sess.dialogue.history`) — предыдущие реплики NPC/моба и выбранные игроком варианты этого же разговора, чтобы AI не генерировала реплики с чистого листа.

---

## Конфиг `assets/config/npc_combat.json`

```json
{
  "relationship": {
    "min": -100, "max": 100,
    "default_kill_delta": -20,
    "default_spare_delta": 10,
    "tiers": [
      { "key": "main_enemy",  "min": -100, "max": -70 },
      { "key": "enemy",       "min": -69,  "max": -25 },
      { "key": "neutral",     "min": -24,  "max": 24  },
      { "key": "friend",      "min": 25,   "max": 69  },
      { "key": "main_friend", "min": 70,   "max": 100 }
    ]
  },
  "memory": {
    "token_char_ratio": 4,
    "max_tokens_session": 1000,
    "max_tokens_account": 500
  },
  "dream": {
    "max_change_default": 10
  }
}
```

| Поле | Описание |
|---|---|
| `relationship.min/max` | Границы клэмпа для любого изменения relationship |
| `relationship.default_kill_delta` | Дельта при `kill`, если у NPC не задан `on_kill.relationship_delta` |
| `relationship.default_spare_delta` | Дельта при `spare`, если не задан `on_spare.relationship_delta` |
| `relationship.tiers` | Метки для `npc:status` (см. выше) |
| `memory.token_char_ratio` | Символов на «токен» в грубой оценке (`length / ratio`) |
| `memory.max_tokens_session` / `max_tokens_account` | Бюджет памяти отдельно для `relationship.mode: "session"` и `"account"` |
| `dream.max_change_default` | `max_change`, если `dream_ai: true` (булево, без явного числа) — и на манифесте, и на узле диалога |

---

## API

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/npc/attack` | `{ npcInstanceId }` — начинает бой с NPC (`on_interact` или из диалога/кнопки) |
| `POST` | `/api/npc/close` | `{ npcInstanceId }` — закрытие чата, запускает `dream_ai` энкаунтер-уровня (fire-and-forget, отвечает `{ok:true}` сразу) |
| `POST` | `/api/npc/trade/buy` / `/api/npc/trade/sell` | Помимо покупки/продажи, пишут запись в `npc.recentTrades` для будущего сна |

Ошибки `/api/npc/attack`: `npc_not_attackable` (нет `npc_combat`), `npc_already_defeated`, а также обычный `combat_active`/`no_game`.

---

## Переводы

Ключи, которые нужно завести при добавлении нового NPC с боем/сном (`assets/translation/{ru,en}/server.json`, если не берутся дефолты из кода):

- `npc_memory.*` — тексты для `pushNpcMemory()` (`npc_memory_killed_permanent`, `npc_memory_defeated_fled`, `npc_memory_spared`, `npc_memory_won_fight`)
- `npc_special_defeat.*` — текст «мягкого» проигрыша игрока NPC
- `npc_dream.system` — системный промт для энкаунтер-уровня `dream_ai` (плейсхолдеры `{name}`, `{max}`, `{rel}`)
- `errors.npc_not_attackable` / `npc_already_defeated` / `npc_not_spareable` / `npc_not_killable`
- `ui.npc.attack_btn` — подпись кнопки «Напасть»
- `dialogue.<id>.attack` / `.leave` — текст опций в конкретном диалоге

---

## Полный пример: `one_lost`

```jsonc
// assets/npc/manifesto.json
{
  "id": "one_lost",
  "level": ["1"],
  "type": "other",
  "dream_ai": { "max_change": 5 },
  "npc_combat": true,
  "combat": {
    "template": { "source": "mob", "id": "the_undead_thief" },
    "overrides": { "name": "Потерянный", "hp": 60 },
    "killable": true,
    "spareable": true,
    "permanent_death": false,
    "aggro": "on_sight",
    "aggro_relationship_below": -100,
    "on_kill":  { "relationship_delta": -2 },
    "on_spare": { "relationship_delta": 1 }
  },
  "relationship": { "default": 0, "mode": "account" }
}
```

```jsonc
// assets/dialogue/one_lost.json — фрагмент
{
  "entry": [
    { "if": [["npc:status", "is", ["enemy", "main_enemy"]]], "node": "open_repeat_hostile" },
    { "if": ["account:npcsMet:one_lost", ["account:gamesStarted", ">=", 2]], "node": "open_repeat" },
    { "if": [], "node": "open" }
  ],
  "script": [
    {
      "id": "lost_rude",
      "is_ai": true,
      "dream_ai": { "max_change": 1 },
      "ai_hint": "Игрок грубо оборвал. Ты не обиделся — просто ушёл в себя.",
      "options": [
        { "text": "Напасть", "if": ["!npc:defeated"], "ends_with": "combat" },
        { "text": "Уйти",                              "ends_with": "close"  }
      ]
    }
  ]
}
```

Читается так: `one_lost` — обычный NPC (не трейдер), при первом входе в его комнату может напасть сам (`aggro: on_sight`), но только если отношение уже на самом дне (`-100`) — то есть игрок его уже почти забил раньше. В бою он выглядит как `the_undead_thief`, но с именем «Потерянный» и HP=60. Убить насмерть его нельзя «навсегда» (`permanent_death: false`) — на следующих этажах он ещё встретится, если выжил. Отношение хранится кросс-сейв (`mode: "account"`) — переживает даже новую игру. `dream_ai` включён и на уровне манифеста (любой чат/бой/трейд с ним резюмируется после закрытия), и точечно на узле `lost_rude` (грубый обрыв разговора — отдельный маленький штрих к памяти и отношению).
