# Серверная логика

Бэкенд разбит на два слоя: **engine/** (чистая логика) и **routes/** (Express-обработчики). Точка входа `server.js` монтирует роутеры и раздаёт статику.

Все манифесты загружаются один раз при старте через `server/engine/data.js`. Изменения в JSON-файлах требуют перезапуска сервера.

---

## server/engine/data.js — Загрузка данных

Читает все манифесты синхронно при `require()` и экспортирует как константы:

```js
PLAYER_BASE    // assets/player.json
MOBS           // assets/mob/manifesto.json
BOSSES         // assets/boss/manifesto.json
ITEMS          // assets/item/manifesto.json
OBJECTS        // assets/object/manifesto.json
MAP            // assets/map/manifesto.json
SKILLS         // assets/skills/manifesto.json
ALL_SKILLS     // [ ...battle, ...survival, ...magic ] — плоский массив
NPCS           // assets/npc/manifesto.json
PROGRESSION    // assets/config/progression.json
DUNGEON_LEVELS // assets/config/dungeon_levels.json
CORE           // assets/config/core.json
COMBAT_CFG     // assets/config/combat.json
SKILLS_CFG     // assets/config/skills.json   — конфигурация UI дерева навыков
CONDITIONS     // assets/config/conditions.json
NARRATIVE      // assets/config/narrative.json
ACHIEVEMENTS   // assets/config/achievements.json
AI_TEST_CFG    // assets/config/ai_test.json     — пороги/оценки для самотестов AI (см. ai.js)
NPC_COMBAT_CFG // assets/config/npc_combat.json  — relationship/memory/dream — см. npc_combat.md
MEDIA          // assets/config/media.json       — sound/music/video для event.json
DIALOGUE       // assets/config/dialogue.json    — сценарные диалоги
EVENT          // assets/config/event.json       — сюжетные события
SCAVENGE       // assets/scavenge/scenes/*.json  — сцены обыска (индекс по scene.id)
```

`MEDIA.sound` отдаётся клиенту как `/api/ui-sounds`. Полный реестр медиа — `/api/media`.

Также содержит `cfg` (настройки из `save/config.json`) и функцию `saveCfg()`.

**Настройки по умолчанию (`CFG_DEFAULTS`):**
```js
{
  provider: 'ollama',
  model: 'gpt-oss:20b-cloud', url: 'http://127.0.0.1:11434',
  ollamaMode: 'local', ollamaCloudKey: '',    // ollamaMode: 'local' | 'cloud' (Ollama Cloud API)
  openrouterKey: '', openrouterModel: 'openai/gpt-oss-120b:free',
  ollamaJsonMode: true, openrouterJsonMode: true,
  cacheMode: true,                            // см. ai.js — влияет на промт-кэширование и формат system-промта моба
  bgVolume: 0.25, battleVolume: 0.25, sfxVolume: 0.2,
  lang: 'ru'
}
```

---

## server/engine/helpers.js — Вспомогательные функции

### `uid() → string`
Генерирует уникальный строковый ID для instance-объектов.

### `rng(min, max) → number`
Случайное целое в диапазоне `[min, max]` включительно.

### `clamp(v, lo, hi) → number`
Ограничивает `v` диапазоном `[lo, hi]`.

### `OPP` / `DELTA`
Словари противоположных направлений и смещений по координатам: `OPP = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }`, `DELTA = { left: [-1,0], right: [1,0], top: [0,-1], bottom: [0,1] }`.

### `parseLevels(spec) → Set<number>`

Парсит поле `level` манифеста в набор номеров:

```
parseLevels(3)          → {3}
parseLevels([1,2,3])    → {1,2,3}
parseLevels("1-5")      → {1,2,3,4,5}
parseLevels(["1-5", 8]) → {1,2,3,4,5,8}
parseLevels(null)       → null  // null = любой уровень
```

### `levelMatches(spec, level) → boolean`
Возвращает `true` если `level` входит в `parseLevels(spec)` (или `spec === null`).

### `resolveMobLevel(requested) → number`
Ищет уровень ≤ `requested`, для которого есть хотя бы один моб. Нужен как fallback, если на текущем уровне нет мобов.

### `resolveMapLevel(requested) → number`
Аналогично `resolveMobLevel`, но для карты — ищет уровень ≤ `requested`, для которого есть хотя бы одна генерационная секция (`MAP.section` с `action: "generation"`).

### `getDungeonLevelCfg(level) → object`
Возвращает конфиг уровня из `DUNGEON_LEVELS` — первый ключ (кроме `"default"`), в `parseLevels()` которого входит `level`; иначе `DUNGEON_LEVELS.default` (или `{ min: 8, max: 14 }`, если и его нет).

### `resolveImags(imags, effects, basePath) → object`
Принимает объект `imags` + отдельный `effects`, возвращает объект с абсолютными путями. Пути в виде строки или массива строк (кадры анимации) обрабатываются поэлементно. `imags.effects` и отдельный `effects` мержатся в один `out.effects`.

---

## server/engine/combat.js — Механика боя

### `E_COST`
Объект `{ action: energyCost }` — энергозатраты. Читается из `PLAYER_BASE.function[action].energy_cost` с fallbackом на `core.mechanics.ability[action].energy_cost`.

### `playerCanDo(player, action) → boolean`
Проверяет: action объявлен в core, не на кулдауне (для heal), достаточно энергии.

### `mobCanDo(mob, action) → boolean`
Проверяет: action включён у моба (`abilities[action].enabled`), не на кулдауне, достаточно энергии.

### `checkSurrenderReady(mob) → boolean`
Проверяет `mob.surrender_difficulty` (число `0..1` или объект `{ hp, energy }`) против текущих `hp`/`energy` моба — готов ли моб предложить сдачу.

### `mobAvailable(mob, playerMsg = '', forceSurrenderReady = false) → string[]`
Возвращает список доступных действий моба (`mobCanDo`). Добавляет `"surrender"`, если игрок написал сообщение и (`forceSurrenderReady` или `checkSurrenderReady(mob)` истинны).

### `blockFor(defAbilityKey, defInt, attackKey) → number`
Сколько блокирует способность защиты `defAbilityKey` (проверяется по `core.mechanics.ability[defAbilityKey].applies_to`) против конкретного действия атаки `attackKey`.

### `statsArmorFor(stats, attackKey) → number`
Суммарная броня от пассивных статов против `attackKey` — по всем `core.mechanics.stats[*].applies_to_ability`, `floor(stat * impact * applyEntry.impact)`.

### `resolveTurn(sess, playerAction, mobAction, canSurrender) → { log, result }`

Оба действия выполняются **одновременно**. Порядок обработки:

1. **Сдача моба:** если `mobAction === "surrender"` — энергия игрока обновляется, лог и `combat.pendingMercy = true`, бой завершается сразу через `result: "mercy_choice"` (HP моба не трогается).
2. Энергия: `add_energy`-действия (`wait`) → восстановление (из `effectiveAbility.int` / `mob.abilities[...].int`), иначе → списание `E_COST` / `energy_cost`.
3. Исцеление (`add_hp`): восстановление HP по `effectiveAbility(player, 'heal').int` / `mob.abilities.heal.int`.
4. Лог `add_energy`-действий (ожидание).
5. Урон от `attack` (по типу действия из `core.mechanics.ability[...].action`, не по хардкод-ключам):
   - Бросок на уклонение (`avoidance * impact`).
   - Крит (`chance_critical` → `rawDmg * (1 + multiplier_critical)`).
   - Блок — только если противник выбрал действие типа `damage_reduction` (`blockFor`).
   - Броня — `statsArmorFor` по всем применимым статам.
   - Итого: `max(0, rawDmg - block - armor)`.
6. Кулдауны: способность с `loop` уходит в кулдаун на `loop` ходов; остальные кулдауны уменьшаются на 1 (кроме применённой в этот ход).
7. **Фазы босса:** `checkPhases(combat, player)` — сработавшие фазы логируются (`type: "phase"`) и применяются необратимо.
8. `combat.turn++`, `combat.elixirUsedThisTurn = false`.
9. Результат: `"victory"`, `"defeat"`, `"mercy_choice"` или `null`.

Если `canSurrender` и HP моба ≤ 0 — HP устанавливается в 1, `combat.pendingMercy = true`, `result: "mercy_choice"`.

### `checkLevelUp(player) → { leveled, newLevel, spGained, grants }`

Сравнивает `player.xp` с `PROGRESSION`. При достижении нового уровня:
- обновляет `player.charLevel` и `player.skillPoints`
- собирает суммарный `grants` со всех пройденных тиров (объект `{ "stats:power:int": N, ... }`)
- возвращает `{ leveled: true, newLevel, spGained, grants }`

`grants` применяются в `routes/combat.js` — добавляются в `player.levelBonuses` и вызывается `recalcStats`.

---

## server/engine/items.js — Предметы и статы

### `itemDef(id) → object | null`
Ищет предмет в `ITEMS` по id.

### `addToInventory(player, id, count)`
Добавляет предмет в инвентарь. Специальный случай: `id === "gold"` → `player.gold += count`.

### `removeFromInventory(player, id, count)`
Уменьшает count. Если count ≤ 0 — удаляет из массива.

### `pickObjectDef(type, dungeonLevel, withFallback = true) → object | null`
Случайно выбирает объект типа `type` (`door_area`, `key_area`, …) из `OBJECTS`, подходящий по уровню. Если на уровне ничего нет и `withFallback` — ищет вниз по уровням до 1. Используется генератором подземелья (`dungeon.js`).

### `parseSpawnRange(val, def = [1, 3]) → [min, max]`
Парсит поле `spawn` объекта: число → `[n, n]`, строка `"a-b"` → `[a, b]`, иначе — `def`.

---

## server/engine/player.js — Статы игрока

### `recalcStats(player)`

Пересчитывает все производные характеристики игрока. Вызывается при экипировке, изучении навыка, повышении уровня, загрузке сохранения.

**Четыре источника бонусов** (суммируются в `player.bonuses`):
1. `player.equip` — статы предметов (`stats: { "ability:attack:int": 12, ... }`)
2. `player.learnedSkills` — из `ALL_SKILLS[id].function.mode[].{ connect, value }`
3. `player.levelBonuses` — накопленные grants от уровней (`{ "stats:power:int": 1, ... }`)
4. `account.achievements` — ачивки типа `"stats"` из `assets/config/achievements.json`, конвертируются через `ACH_CONNECT` (`hp` → `player:max_hp`, `attack` → `ability:attack:int`, и т.д.) — применяются при каждом пересчёте, чтобы переживать save/load

**Расчёт `player.stats`** (пассивные характеристики):
```
stats[id] = (PLAYER_BASE.stats?.[id] ?? core.stats[id].int ?? 0) + bonuses["stats:id:int"] ?? 0
```

**Применение `mode[]`** из `core.stats`:
- `type: "stats"` → прибавляет `val * impact` к другому стату
- `type: "ability"` → прибавляет в `bonuses["ability:id:field"]`
- `type: "effects"` → прибавляет в `bonuses["effects:id:field"]`

Итогово пересчитываются: `maxHp`, `maxEnergy`, `critChance`, `critMultiplier`, `player.hp`/`energy` (clamp).

### `applyEndCombatRefresh(player)`

После победы или mercy (`routes/combat.js`). Читает `combat_system.end_combat`:

```
value = clamp(floor(max * refresh_pct + current * leftover_mult), 0, max)
```

Если `refresh_pct` и `leftover_mult` оба `0` — ресурс не меняется (например `mana` до внедрения магии).

| Ресурс | Поля игрока |
|--------|-------------|
| `energy` | `energy` / `maxEnergy` |
| `hp` | `hp` / `maxHp` |
| `mana` | `stats.mana` / `manaMax(player)` |

Побег (`/api/combat/flee`) и поражение — без refresh.

### `effectiveAbility(player, id) → { int, chance_critical, multiplier_critical, energy_cost, loop }`

Базовое значение из `PLAYER_BASE.function[id]` + `player.bonuses["ability:id:*"]`.

### `checkRequired(required, player) → boolean`
Проверяет массив строк `"entity:id[:val]"` (`skill:`, `level:`, `item:`, `stats:`) против состояния игрока. Используется `resolveAbilities` для фильтрации способностей с полем `required`.

### `refreshResource(current, max, cfg) → number`
`clamp(floor(max * refresh_pct + current * leftover_mult), 0, max)`. Если `refresh_pct` и `leftover_mult` оба `0` — возвращает `current` без изменений. Общая формула, на которой строится `applyEndCombatRefresh`.

### `manaMax(player) → number`
`PLAYER_BASE.stats.mana + player.bonuses['stats:mana:int']` — текущий максимум маны с учётом бонусов.

### `resolveAbilities(player) → object`

Возвращает словарь всех доступных игроку способностей (из `core.mechanics.ability`), отфильтрованных по `required` (через `checkRequired`) и `player.json action: true`.

---

## server/engine/mob.js — Мобы

### `getAbilityMult(multiplier, key, level) → number`
Вычисляет `m^(level-1)`, где `m` — из числовой или объектной формы `multiplier`.

### `resolveMobStats(base, level) → object`
Вычисляет пассивные характеристики моба:
```
stats[id] = (base.stats?.[id] ?? core.stats[id].int ?? 0) * getAbilityMult(base.multiplier?.stats, id, level)
```

### `resolveMobAbilities(base, level) → object`

Собирает способности из `base.function` (только с `action: true`), масштабируя `int` через multiplier. Из `core.json` переносятся поля `sound` и `sound_volume` для каждой способности.

### `applyStatModes(stats, abilities)`
Применяет `mode` из `core.stats` к способностям моба (только `type: "ability"`).

### `deepMerge(target, patch) → target`
Рекурсивный merge-патч объекта (без мутации вложенных оригиналов — создаёт новые объекты по пути патча). Общая утилита, используемая и `applyMobScript`, и NPC-боевым оверлеем (`npc.js` → `spawnNpcCombat`, см. [npc_combat.md](npc_combat.md)).

### `applyMobScript(base, ctx) → base`

Применяет записи `base.script` типа `"edit"`, у которых выполняется `evalAll(entry.if, ctx)` (`ctx = { mob, player }`), как `deepMerge`-патчи поверх клона `base`. Если ничего не сработало — возвращает исходный `base` без клонирования (no clone overhead).

Помечает патченный объект временным полем `patched.__scriptTouchedFields` — список верхнеуровневых ключей, тронутых скриптом. Поле никогда не попадает в финальный заспавненный объект: оно нужно `buildMobFromBase`, чтобы пропустить перевод (`t()`) для явно патченных текстовых полей и не дать шаблонному переводу тихо затереть патч.

### `translateEncounterText(enc, mobId, skipTranslation = false) → object | null`

Переводит блок `encounter_text` моба:
- Проверяет ключ `encounter_default` в файле перевода моба; если найден — использует его вместо `enc.default`.
- Для каждого варианта ищет ключ `v.key` в переводе; если не найден — берёт `v.text` напрямую.
- Пропускает варианты без текста и без перевода.

Если `skipTranslation` — перевод полностью пропускается, поля берутся как есть из `enc` (используется, когда `encounter_text` был явно патчен скриптом или NPC-оверлеем).

Возвращает `{ default, is_ai, variants }` или `null`.

### `buildMobFromBase(base, level = 1) → mob`

Строит финальный спавн-готовый объект моба из уже резолвнутого `base` (после `applyMobScript` / NPC-оверлея — см. `spawnMob` и `npc.js:spawnNpcCombat`). Считает `stats`/`abilities` (`resolveMobStats` + `applyStatModes`), масштабирует `hp`/`energy`/`xp` по `multiplier`, резолвит `name`/`promt`/`encounter_text` — пропуская перевод для полей, отмеченных в `base.__scriptTouchedFields`.

### `spawnMob(level, allowedIds?, ctx = null) → mob`
Создаёт экземпляр моба:
1. Фильтрует `MOBS` по уровню (с fallback через `resolveMobLevel`) и (если `allowedIds` не задан) по `random_spawn !== false`.
2. Взвешенный рандом (`pickWeighted`).
3. Применяет `applyMobScript(picked, ctx)`.
4. Строит объект через `buildMobFromBase`.

---

## server/engine/boss.js — Боссы

### Общее

Боссы — особый тип врагов из `assets/boss/manifesto.json`. Отличия от мобов:
- Поддерживают **фазы** (`phase[]`) — переходы в новое состояние при выполнении условий
- Помечены флагом `isBoss: true` в runtime-объекте
- Спрайты берутся из `/assets/boss/`, а не `/assets/mob/`
- В дампе `pubRoom` поле `hasBoss: true` (дополнительно к `hasMob`)

### `translateBossEncounterText(enc, bossId, skipTranslation = false) → object | null`
То же самое, что `mob.js:translateEncounterText`, но по неймспейсу `'boss'`. `skipTranslation` пропускает перевод для полей, явно патченных NPC-оверлеем (см. [npc_combat.md](npc_combat.md)).

### `buildBossFromBase(base, level = 1) → boss`

Строит финальный спавн-готовый объект босса из уже резолвнутого `base` (общая логика с `buildMobFromBase`: `stats`/`abilities` через `resolveMobStats`/`resolveMobAbilities`/`applyStatModes`, масштабирование `hp`/`xp`, перевод `name`/`promt`/`encounter_text` с уважением к `base.__scriptTouchedFields`). Дополнительно резолвит `phases: resolvePhases(base, level)` и ставит `isBoss: true`, `source: 'boss'`. Используется как обычным `spawnBoss`, так и NPC-боевым оверлеем (`npc.js:spawnNpcCombat`).

### `spawnBoss(bossId, level = 1) → boss`
Тонкая обёртка: находит `base` в `BOSSES` и вызывает `buildBossFromBase(base, level)`.

### `resolvePhases(base, level) → phase[]`

Предрасчёт фаз при спавне. Каждая фаза:
- `phase` — номер фазы
- `phase_name` — переведённое имя
- `phase_text` — необязательный текст перехода (из перевода)
- `if` — условие срабатывания (выражение или массив выражений)
- `style`, `imags` — визуальные оверлеи (мерджатся)
- `stats` — патч статов (масштабируется через `multiplier.stats`)
- `function` — патч способностей (масштабируется через `multiplier[abilId]`)

### `evalPhaseIf(ifExpr, ctx) → boolean`

Вычисляет условие фазы. Контекст `ctx = { mob, player }`.

**Форматы условий:**
```jsonc
// Прямое сравнение
["mob:hp", "<", ["mob:maxHp", "*", 0.5]]

// AND-массив условий
[["mob:hp", "<", 50], ["player:hp", "<", 30]]

// Ссылка-выражение (правая часть)
["mob:maxHp", "*", 0.5]   → mob.maxHp * 0.5
```

**Операторы:** `>`, `>=`, `<`, `<=`, `=` / `==`, `!=`  
**Пространства имён:** `mob:*`, `player:*` (вложенный путь через `:`)

### `applyPhase(boss, phase)`

Применяет фазу к живому объекту босса (merge-patch семантика):
- `style` / `imags` — глубокий мердж
- `stats` — field-patch → ре-запускает `applyStatModes` для синхронизации бонусов
- `function` — field-patch по способностям
- `energy` — заменяет `maxEnergy`, energy clamp'ится

### `checkPhases(combat, player) → phase[]`

Проверяет все нетриггерные фазы босса. Сработавшие применяются немедленно через `applyPhase` и добавляются в `boss.triggeredPhases` (необратимо).  
Возвращает массив новых сработавших фаз.

---

## server/engine/account.js — Кросс-сейв аккаунт

Хранилище `save/account.json` — переживает рестарт игры и удаление отдельных сохранений (ачивки, счётчики, а также cross-save NPC-состояние). Единственный модуль, который пишет в этот файл напрямую (`_save()` после каждого мутирующего вызова).

**`DEFAULTS`:** `gamesStarted`, `totalDefeats`, `maxFloor`, `totalKills`, `totalSpared`, `totalBossKills`, `totalNpcMet`, `npcsMet: []`, `achievements: []`, `npcRelationships: {}`, `npcMemory: {}`, `eventsFired: []`.

### `trackGameStarted()` / `trackDefeat()` / `trackFloor(floor)` / `trackKill(mobId)` / `trackSpared()` / `trackNpcMet(defId)`
Инкрементируют соответствующие счётчики и сохраняют. `trackKill` дополнительно инкрементирует `totalBossKills`, если `mobId` есть в `BOSSES`. `trackFloor` обновляет `maxFloor` только если `floor` больше текущего.

### `hasFiredEvent(eventId)` / `markFiredEvent(eventId)`
Кросс-сейв «once» для событий (`event.json`'s `once_account: true`) — `eventsFired: []`. В отличие от обычного `once` (сессионный флаг в памяти, `sess.player.storyFlags`), переживает рестарт сервера и новую игру; сбрасывается только через `resetAccount()`.

### `resetAccount()`
Сбрасывает счётчики и ачивки к `DEFAULTS` (используется явным сбросом прогресса, не путать с `/api/new-game`).

### `grantAchievement(id) → boolean`
Добавляет ачивку, если её ещё нет. Возвращает `true`, если выдана впервые, `false` — если уже была.

### NPC relationship / memory (cross-save режим, см. [npc_combat.md](npc_combat.md))

Используются NPC с `relationship.mode: "account"` — отношение и память хранятся здесь вместо сессии, переживая даже удаление сейва.

- `estimateTokens(text) → number` — грубая оценка токенов без токенайзера: `ceil(text.length / token_char_ratio)` (`NPC_COMBAT_CFG.memory.token_char_ratio`).
- `capMemoryTokens(list, maxTokens) → list` — выкидывает старые записи с начала списка, пока суммарная оценка токенов не уложится в `maxTokens`. Мутирует и возвращает `list`; общая функция и для сессионной, и для account-памяти NPC.
- `getAccountRelationship(defId, dflt = 0) → number` — читает (и лениво инициализирует) `account.npcRelationships[defId]`.
- `adjustAccountRelationship(defId, delta) → number` — прибавляет `delta`, клампит по `NPC_COMBAT_CFG.relationship.{min,max}`, сохраняет.
- `getAccountMemory(defId) → string[]` — `account.npcMemory[defId] ?? []`.
- `pushAccountMemory(defId, line) → string[]` — добавляет строку, обрезает через `capMemoryTokens` до `NPC_COMBAT_CFG.memory.max_tokens_account`, сохраняет.

---

## server/engine/npc.js — NPC

### `spawnNpc(dungeonLevel, allowedIds) → npc`

Создаёт экземпляр NPC из `NPCS`: резолвит `promt`/`name`/`narrative_text`, собирает `shop` (для `type: "trader"`, с шансом появления и скидкой на позицию), инициализирует боевое/социальное состояние — `relationship`/`memory` (из аккаунта, если `relationship.mode: "account"`, иначе дефолт сессии), `defeated: false`, `recentTrades: []`, `dreamedUpTo: 0`. Подробности боевого оверлея и relationship/memory — в [npc_combat.md](npc_combat.md).

### `translateNpcNarrativeText(enc, npcId) → object | null`
Аналог `mob.js:translateEncounterText` для блока `narrative_text` NPC (неймспейс `'npc'`, ключ `narrative_default`).

### `adjustNpcRelationship(npc, base, delta) → number`
Меняет `npc.relationship`: если `base.relationship.mode === 'account'` — делегирует в `account.js:adjustAccountRelationship`; иначе клампит локально по `NPC_COMBAT_CFG.relationship.{min,max}`.

### `pushNpcMemory(npc, base, key, fallback, vars = {}) → string[]` / `pushNpcMemoryLine(npc, base, line) → string[]`
Добавляют строку в память NPC (сессионную или account, в зависимости от `relationship.mode`). `pushNpcMemory` сначала резолвит `t('server', 'npc_memory', key, fallback)` и подставляет `{var}`-плейсхолдеры; `pushNpcMemoryLine` пишет уже готовую строку (используется `dream_ai`, где текст приходит от AI).

### `dreamAboutEncounter(npc, base, { combatOutcome = null } = {})`

«Сон» NPC — асинхронно, после закрытия чата и/или боя, просит AI одной фразой от первого лица подвести итог встречи (собирает `history`/`recentTrades`/`combatOutcome` в транскрипт) и предложить сдвиг отношения, клампится по `dream_ai.max_change` (или `NPC_COMBAT_CFG.dream.max_change_default`). Не запускается, если нет `base.dream_ai` и новых материалов с прошлого сна (`hasNewDreamMaterial`). Полная схема — в [npc_combat.md](npc_combat.md).

### `spawnNpcCombat(npc, level = 1, ctx = null) → mob | boss | null`

Строит боевого противника из шаблона NPC (`base.combat.template` → `mob`/`boss` манифест), применяет `applyMobScript` (если источник — моб) и затем `base.combat.overrides` через `deepMerge` (оверлей всегда последним), строит объект через `buildMobFromBase`/`buildBossFromBase` и добавляет `combatant.sourceNpc` (`instanceId`, `defId`, `npcType`, `killable`, `spareable`, `permanentDeath`, `onKill`, `onSpare`, `onPlayerDefeat`). Явно переопределённые `name`/`promt` резолвятся под id самого NPC, чтобы оверлей не перетёрся переводом шаблона. См. [npc_combat.md](npc_combat.md) §4/§6.

### `pubNpc(npc) → object`
Публичное представление NPC для API. Включает `canAttack` (`true`, если у шаблона есть `npc_combat` и NPC ещё не `defeated`) и `defeated`.

### `npcSystempromt(npc, jsonMode = false) → string`
Системный промт для чата с NPC: характер, товары (если трейдер), блок памяти (`npc.memory.slice(-5)`), формат ответа. Как и в `mobSystempromt`, если память не пуста — сразу после неё добавляется явная инструкция «учитывай эти воспоминания в разговоре..» (`npc_system.memory_instruction`), иначе слабые модели просто игнорируют голый контекст.

### `parseNpcReply(text, jsonMode) → string`
Парсит реплику NPC из ответа AI (JSON или `SPEECH:`-формат).

### `npcInCurrentRoom(sess, instanceId) → npc | null`
Возвращает NPC текущей комнаты, если его `instanceId` совпадает.

---

## server/engine/session.js — Сессия

### `state`
Объект `{ session: null }` — единственная активная сессия сервера.

### `newSession(level = 1, inheritPlayer = null, inheritJournal = []) → session`
Создаёт новую сессию. Если `inheritPlayer` не передан — создаёт нового игрока с базовыми значениями из `PLAYER_BASE` + `levelBonuses: {}`; стартовые `skillPoints` дополнительно включают очки от уже полученных ачивок типа `"point"` (`account.achievements`). Вызывает `recalcStats`. Генерирует подземелье через `generateDungeon(level, { player })`.

### Slim / Hydrate

Перед записью на диск объекты "сжимаются" (`slim*`): инвентарь → `[{id, count}]`, equip → `{slot: id}`, mob → только изменяемые поля. При чтении "гидрируются" обратно (`hydrate*`) из манифестов.

| Функция | Что делает |
|---------|-----------|
| `slimSession` / `hydrateSession` | Вся сессия |
| `slimPlayer` / `hydratePlayer` | Игрок |
| `slimMob` / `hydrateMob` | Моб или босс (перевычисляет stats/abilities из манифеста) |
| `slimNpc` / `hydrateNpc` | NPC |
| `slimObject` / `hydrateObject` | Объект комнаты |

`hydrateMob` работает и для мобов, и для боссов — определяет тип по полю `slim.source === 'boss'`.

`slimNpc`/`hydrateNpc` сохраняют боевое/социальное состояние NPC через round-trip (иначе оно бы тихо сбрасывалось при смене языка, save/load или перезагрузке `.session.json`) — см. [npc_combat.md](npc_combat.md):
- `defeated`, `relationship`, `memory`, `recentTrades`, `dreamedUpTo`

`hydrateNpc` для NPC с `relationship.mode: "account"` не доверяет сохранённому снапшоту — заново читает live-значение из `account.js` (`getAccountRelationship`/`getAccountMemory`), чтобы всегда отражать актуальный `account.json`.

### `pubSession(sess) → object`

Готовит публичное представление сессии для API-ответов. Включает:
- `player`, `dungeon`, `combat`, `abilities`, `playerImags`, `currentRoom`
- Поля звуковой системы:
  - `playerSoundSpec` — карта звуков из `player.json.sound`
  - `playerSoundVolume` — мультипликатор из `player.json.sound_volume`
  - `coreSoundDefault` — глобальный fallback-звук из `core.mechanics.default_sound`
  - `coreSoundDefaultVolume` — мастер-мультипликатор из `core.mechanics.default_sound_volume`
  - `coreSoundDefaultMob` — глобальные звуки мобов из `core.mechanics.default_sound_mob`
- В `combat.mob`: поля `sound`, `soundVolume`, `isBoss`, `style`, `phases`, `triggeredPhases`, `sourceNpc` (если бой пришёл от NPC — см. [npc_combat.md](npc_combat.md))

### `saveSessionAuto()` / `clearSessionAuto()`
Записывает / удаляет `save/.session.json` (slim-формат). Вызывается после каждого изменения состояния.

### `doSave(sess) → saveId`
Сохраняет в `save/YYYY-MM-DD-HH-MM-SS/` три файла: `player.json`, `world.json`, `journal.json`.

### `doLoad(saveId) → session`
Читает три файла, вызывает `hydrateSession`.

---

## server/engine/dungeon.js — Генератор подземелья

### `pickSection(passages, isSpawn, level = 1) → section | null`
Подбирает секцию карты (`MAP.section`) под уже известные проходы соседней комнаты: сперва ищет точное совпадение по всем 4 направлениям, иначе — секцию с максимальным числом совпадающих проходов, не создающую лишних. Для `isSpawn` — просто случайная секция с `action: "spawn"`.

### `sectionPreview(sec) → string`
`sec?.preview ?? MAP.preview ?? 'preview/default.png'`.

### `generateDungeon(dungeonLevel, ctx = null) → rooms`

Точка входа генератора. Если для уровня в `dungeon_levels.json` (`getDungeonLevelCfg`) указан `plan[]` — случайно выбирает один файл плана и делегирует в `loadPreMadeMap`. Иначе строит подземелье процедурно (BFS/frontier-алгоритм по сетке координат).

`ctx = { player }` — используется при спавне мобов/NPC (скрипты мобов, фильтр `player.deadNpcIds`).

**Процедурная генерация — шаги:**
1. **Spawn-комната** в `(0,0)`.
2. **Frontier** — список ячеек для заполнения из открытых проходов spawn.
3. **Цикл** (min–max комнат из `dungeon_levels.json`, через `getDungeonLevelCfg`): берём ячейку из frontier, ищем подходящую секцию карты (с учётом `always`-секций, форсирования тупиков под конец бюджета), заполняем.
4. **Заделка** висячих проходов, для которых не нашлось секции.
5. **Consistency-pass** — итеративно убирает односторонние проходы (пока не стабилизируется) и удаляет комнаты без единого прохода.
6. **Дверь/ключ:** дверь — в самый далёкий тупик (или обычную комнату, если тупиков нет); ключ — в другой тупик, с учётом весов объектов (`_objectWeight`), чтобы не переполнить комнату.
7. **`always`-секции** — гарантированно ставятся хотя бы раз, если ещё не размещены.
8. **Обычные предметы** (`spawn_object` / `chance_spawn_object`) — расставляются по весу (`weight`) и диапазону `spawn` (`parseSpawnRange`).
9. **Мобы** — по `chance_spawn_mob` (дефолты по типу комнаты: `normal: 0.45`, `key_area: 0.55`, `door_area: 0`), через `spawnMob(level, mobIds, ctx)`.
10. **NPC** — по `chance_spawn_npc`/`spawn_npc`, только в комнатах без моба; кандидаты фильтруются по уровню, лимиту `count_spawn_level` и **исключают `id` из `ctx.player.deadNpcIds`** (NPC, которых игрок уже насмерть убил в `npc_combat` с `permanent_death`).
11. **Боссы** — секционные (`chance_spawn_boss`/`spawn_boss`, только в комнатах без моба/NPC) и дверные (`dungeon_levels.json` → `boss[].action === "door"`, ставится в дверную комнату, если она ещё пуста).
12. **`min_mob`-гарантия:** если после всего мобов меньше `lvlCfg.min_mob`, довспавнивает их в случайные пустые комнаты (кроме дверной).

### `loadPreMadeMap(filePath, dungeonLevel, ctx = null) → rooms`

Загружает готовый план из `assets/{filePath}` (координаты комнат нормализуются относительно spawn-комнаты плана) и прогоняет те же шаги расстановки контента (дверь/ключ, мобы, NPC, боссы — секционные и дверные), что и процедурная генерация, но без построения графа проходов — он уже задан в плане.

---

## server/engine/ai.js — Интеграция с LLM

### `aiChat(messages, jsonMode, conf = cfg) → string`
Отправляет историю сообщений в Ollama или OpenRouter (`ollamaChat`/`openrouterChat` — выбор по `conf.provider`). Из ответа всегда вырезаются блоки `<think>...</think>` (некоторые модели, например DeepSeek-R1/QwQ/gpt-oss-reasoning, кладут рассуждения прямо в `content`).

Единственная точка входа для всех AI-вызовов в игре (бой, NPC-чат, нарратив, dream_ai, диалоги, ai-test) — поэтому именно здесь, а не в каждом вызывающем месте, при `DEV_MODE` (см. [devlog.js](#serverenginedevlogjs--dev-режим-и-лог-ai-вызовов) ниже) пишется запись в лог: `messages`, `response`/`error`, `ms`, `provider`/`model`, `jsonMode` и «откуда вызвано» (`caller` — берётся из стека вызовов над `aiChat`, без изменения самих вызывающих мест).

Ollama-провайдер поддерживает два режима: `conf.ollamaMode === 'cloud'` — запрос идёт на `https://ollama.com/api/chat` с `Authorization: Bearer conf.ollamaCloudKey`; иначе — на локальный `conf.url`. При `conf.cacheMode` и локальном режиме добавляется `keep_alive: '30m'`, чтобы модель не выгружалась между ходами.

OpenRouter-провайдер при `conf.cacheMode` оборачивает system-сообщения в `{ type: 'text', text, cache_control: { type: 'ephemeral' } }` для промт-кэширования.

### AI-доступность и самотесты

Настройки AI (провайдер/модель/ключи) проверяются явным тестом из UI, а не на каждый ход — это отдельная фича от `npc_combat`/`dream_ai`.

- `isAiVerified(conf = cfg) → boolean` / `markAiVerified(conf = cfg)` — кэш результата проверки на время жизни процесса, привязанный к «подписи» текущих настроек (`_aiSignature`: provider/model/url/ollamaMode/ollamaCloudKey/openrouterModel/openrouterKey). Смена любого из этих полей автоматически инвалидирует проверку.
- `aiTestBasic(conf) → { id, ok, ms, detail }` — тест связности: модель должна ответить хоть что-то.
- `aiTestCombat(conf, jsonMode) → { id, ok, ms, detail }` — ролевой тест боя: модель должна ответить в боевом формате и выбрать одно из `attack/defend/wait/heal`.
- `aiTestPerception(conf) → { id, ok, ms, detail }` — тест восприятия чисел боя: модель получает конкретные HP/урон и должна корректно классифицировать их в JSON (`low_hp`, `enemy_stronger`).
- `rateAiResults(results, testCfg = AI_TEST_CFG) → { score, ratingKey, avgMs }` — если все тесты прошли, оценка `0..100` строится из средней задержки (`AI_TEST_CFG.speed_ms.{excellent,good,fair}`); если хоть один провалился — оценка пропорциональна доле пройденных. `ratingKey` — ближайший рейтинг из `AI_TEST_CFG.ratings` (по `min_score`).

### `buildPromtText(promt) → string`
Собирает текстовое описание персонажа (моба/NPC) из объектной формы `promt` (`general`/`soul`/`behavior`/`communication_style`) в одну строку с переведёнными подписями. Строковый `promt` возвращается как есть.

### `loadLangFile(pathTemplate) → string | null` (alias: `loadNarratorPrompt`)

Загружает текстовый файл, зависящий от языка:
1. Подставляет активный язык (`cfg.lang`) вместо `{lang}` в шаблоне пути.
2. Если файл существует — возвращает его содержимое.
3. Иначе — подставляет `CORE_LANG` (язык по умолчанию из `translation.json`) и повторяет.
4. Если ни один файл не найден — возвращает `null`.

Используется и для промтов нарратора (`narrative.json` → `path_promt_narrator`), и для `promt_path`/`combat.promt_path` мобов/боссов/NPC.

### `narrateText(text, syspromptOverride?) → string`

Отправляет текст нарратору: `[system: syspromptOverride, user: text]`. Если `syspromptOverride` не передан — использует дефолтный промт из ключа перевода `mob_system.narrate_system`. К системному промту (дефолтному или переданному) всегда дописывается `"Respond only in ${langName()}."` — раньше язык ответа тут вообще не указывался явно, из-за чего слабые модели иногда отвечали по-английски независимо от активного языка игры. Возвращает переработанный текст.

### `mobSystempromt(mob, canSurrender = false, jsonMode = false, player = null) → string`
Строит статичную часть системного промта для AI-моба: характер (`buildPromtText`), пределы HP/энергии, блок памяти (`mob.memory.slice(-5)`, до 10 хранится — см. `routes/combat.js`), заметка про возможность сдачи (если `canSurrender`), инструкция по формату ответа. Динамические подсказки про состояние игрока добавляются в промт только если `cfg.cacheMode` выключен — иначе они уходят в сообщение хода, а не в system (чтобы не ломать промт-кэш).

Если память не пуста, сразу после неё добавляется явная инструкция (`mob_system.memory_instruction`) в духе «учитывай эти заметки в бою — пусть влияют на поведение и тон, но не пересказывай дословно». Голый контекст без прямой команды использовать его слабые модели нередко просто игнорируют; при пустой памяти инструкция не добавляется.

Ожидаемый формат ответа моба:
```
ACTION: attack
SPEECH: Ты умрёшь!
NOTES: Противник использует heal при низком HP
```
(В JSON-режиме — `{ "action": ..., "speech": ..., "notes": ... }`)

### `parseMobReply(raw, jsonMode) → { action, speech, notes }`
Парсит ответ AI. Если ACTION содержит недоступное действие — роут заменяет его первым из `mobAvailable`.

### `checkAiSurrender(mob, playerMsg, ctx) → Promise<boolean>`
Классификатор убеждения: проверяет, специфично ли сообщение игрока апеллирует к желаниям/страхам/мотивации именно этого моба (а не просто «давай жить мирно»). Работает только если у моба есть подходящая запись `script` типа `"ai_surrender"` (условие `if` через `evalAll(entry.if, ctx)`) и сообщение достаточно длинное (`min_msg_length`, дефолт 20). Общие подсказки (`hint`) из всех подходящих записей передаются модели как дополнительный контекст.

---

## server/engine/translation.js — Локализация

`LANGS` — список языков из `assets/config/translation.json`. `CORE_LANG` — код языка с `is_core: true` (базовый fallback, по умолчанию `'en'`).

### `langName(langCode = cfg.lang) → string`
Полное английское название языка по коду (`ru → "Russian"`, `en → "English"`, …, из `LANG_NAMES`). Используется везде, где промт должен явно закрепить язык ответа модели (`"Respond only in ${langName()}."`) — слабые модели иначе могут проигнорировать язык окружающих инструкций и ответить на английском. Раньше жила в `ai.js`, перенесена сюда — правила языка не специфичны для AI-слоя.

### `t(ns, section, key, fallback) → string`
Возвращает локализованную строку: активный язык → `CORE_LANG` → `fallback`. `key` может быть `[key, vars]` — тогда после резолва в строке подставляются плейсхолдеры `{var}` из `vars`.

### `setLang(code)`
Переключает язык (перегружает `TR_ACTIVE`). При смене языка `routes/meta.js` ре-гидрирует сессию, чтобы имена мобов/предметов обновились.

### `getSection(ns) → object`
Возвращает весь раздел словаря, смерженный `CORE_LANG → активный` (используется для `/api/ui-strings`).

### `resolvePromt(ns, id, basePromt) → string | object`
`t(ns, id, 'promt', basePromt ?? '')` — переведённый `promt` моба/босса/NPC. Значение может быть строкой или объектом (`{ general, soul, behavior, communication_style }`) — прозрачно передаётся дальше в `ai.js:buildPromtText`.

---

## server/engine/conditions.js — Условия

Общий движок для `event.json`, `dialogue.json`, фаз боссов и вариантов нарратива. `ctx` — обычно `state.session` (полная серверная сессия: `ctx.player`, `ctx.dungeon`, …).

### `resolveRef(ref, ctx) → number | string`
Резолвит ссылку по неймспейсу или вычисляет арифметическое выражение `[base, op, scalar]` (`*`/`/`/`+`/`-`):

| Неймспейс | Пример | Что возвращает |
|-----------|--------|----------------|
| `session:*` | `session:dungeon:level` | `ctx[...]`, приведено к числу |
| `player:*` | `player:hp` | `ctx.player[...]`, приведено к числу |
| `storyFlag:key` | | `1`, если флаг truthy, иначе `0` |
| `npc:defeated` | | `1`, если NPC текущей комнаты имеет это поле truthy |
| `npc:status` | | **строка** — тир отношения NPC текущей комнаты (`"main_enemy"`.. `"main_friend"`, см. `NPC_COMBAT_CFG.relationship.tiers`), `"neutral"` по умолчанию — см. [npc_combat.md](npc_combat.md) |
| `condition:id` | | рекурсивно вычисляет `CONDITIONS`-запись по id |
| `skill:id` | | `1`, если навык изучен |
| `account:*` | `account:npcsMet:one_lost` | счётчики/массивы из `account.js` |
| `achievement:id` | | `1`, если ачивка получена |

### `evalCond(cond, ctx) → boolean`
Одно условие. Строка с `!`-префиксом — отрицание. Массив `[lhs, op, rhs]` со сравнением (`>`, `>=`, `<`, `<=`, `=`/`==`, `!=`) или спец-оператором **`is`** — членство/точное совпадение строки, не резолвит `rhs` как ссылку: `["npc:status", "is", ["main_enemy", "enemy"]]` или `["npc:status", "is", "friend"]`. Массив без оператора-сравнения трактуется как вложенный AND.

### `evalAll(conditions, ctx) → boolean`
AND-массив условий (`evalCond` по каждому).

### `resolveEntry(entries, ctx) → entry | null`
Возвращает первую запись `{ if, node }`, чей `if` прошёл `evalAll` — используется для входных точек диалогов (`dialogue.entry`/`before.entry`/`outro.entry`).

### `applySet(setMap, sess)`
Запись в `sess.player.storyFlags[key]` (`storyFlag:key`) или произвольное поле `sess.player` (`session:player:key`).

Клиентская зеркальная логика (только `condition:*` для HTML) — `public/js/conditions.js`.

---

## server/engine/dialogue.js — Сценарный диалог

Управляет `session.dialogue` при прохождении записей из `DIALOGUE`.

**Состояние сессии:**
```js
{ id, phase: 'before'|'main'|'outro', currentNode, history }
```

`history` — массив `{role: 'assistant'|'user', content}`, накапливаемый по ходу диалога (см. ниже) и подмешиваемый в `aiChat` перед генерацией каждой следующей AI-реплики; создаётся лениво (`??=`), поэтому естественно сбрасывается при каждом новом `startDialogue` (объект `sess.dialogue` пересоздаётся) и переживает переходы между фазами `before → main → outro` (объект там не пересоздаётся, а мутируется).

### `startDialogue(dialogueId, sess) → PreparedNode`
Проверяет условия входа (`before` → `script` → `outro`), генерирует текст узла (шаблон или AI через `ai_hint`) и подготавливает его для клиента (`_prepareNode`).

### `advanceDialogue(choiceIndex, sess) → PreparedNode | { done, ends_with }`
Переход по `node.next`, ветвление по `node.options[]` (индекс — среди опций, видимых после фильтрации по `if`), применение `set` на сервере, переход между фазами (`before → main → outro`). При завершении очищает `session.dialogue`.

**`ends_with`:** подсказка клиенту — `"combat"`, `"shop"`, `"free_chat"`, `"close"` или `null`.

### Генерация текста узла (`_generateText`) и `dream_ai`

Если `node.is_ai`, текст строки генерируется через AI (`ai_hint` + инструкция формата, на языке `langName(cfg.lang)` — см. `translation.js`). Необязательное поле узла `node.dream_ai` (осмысленно только вместе с `is_ai: true`) подключает NPC из текущей комнаты как контекст и/или источник изменения отношения — см. «`dream_ai`» в [npc_combat.md](npc_combat.md):

- `dream_ai: true` — только добавляет в промт блок `THINGS YOU REMEMBER ABOUT THIS PERSON` из `npc.memory`.
- `dream_ai: { max_change: N }` — дополнительно просит модель одновременно вернуть `memory` (заметка) и `relationship_delta` (клампится ±N) в одном JSON-ответе вместе с текстом реплики; оба сразу же сохраняются (`pushNpcMemoryLine` / `adjustNpcRelationship`).

Молча ничего не делает, если в текущей комнате нет NPC (например, диалог босса без NPC-контекста).

Помимо `dream_ai`, каждый AI-запрос этой функции получает ещё два независимых источника контекста:

- **Лор (`_loreFor(dialogue)`)** — `dialogue.lore`, если задан (путь вида `assets/translation/{lang}/promts/lore/one_lost.md`, грузится через `loadLangFile`), иначе общий `assets/translation/{lang}/promts/lore/default.md`. Никогда оба сразу — личный лор существует именно для того, чтобы NPC, который толком ничего не знает о мире, не получал на каждую реплику целый пласт лора про церковь/паладинов, который ему не нужен.
- **История диалога (`sess.dialogue.history`)** — предыдущие реплики этого диалога (что уже сказал NPC/моб, что выбрал игрок) передаются в `aiChat` как отдельные `assistant`/`user` сообщения перед финальным `{role:'user', content:'Line:'}`. `_prepareNode` пишет туда ответ NPC/моба сразу после генерации (для любого узла с `speaker: 'npc'|'mob'`, не только AI-узлов), а `advanceDialogue` — выбранный игроком вариант в момент выбора. Капается на 16 записей. Без этого модель генерировала каждую реплику с чистого листа, не видя ни свои прошлые слова, ни то, что спрашивал игрок.

Переводы текстов: `assets/translation/{lang}/dialogue.json` и ключи `text_key` вида `ns.id.field`.

---

## server/engine/devlog.js — Dev-режим и лог AI-вызовов

Активен только если процесс запущен с флагом `-developer` (`node server.js -developer` / упакованный `.exe -developer`, читается из `process.argv`). В остальных случаях весь модуль — no-op.

- `DEV_MODE` — булев флаг, вычисляется один раз при запуске процесса.
- `pushAiLog(entry)` — кладёт запись в кольцевой буфер в памяти (макс. 300, старые вытесняются), no-op если `DEV_MODE` выключен. Длинные строки (`messages[].content`, `response`) обрезаются до 20000 символов. Не пишется на диск, сбрасывается при рестарте.
- `getAiLog(sinceId = 0) → entry[]` — записи с `id > sinceId` (для инкрементального поллинга с клиента).
- `clearAiLog()` — очищает буфер.

Единственный вызывающий — `aiChat()` в `ai.js` (см. выше): туда же приходят `messages`/`response`/`error`/`ms`/`provider`/`model`/`jsonMode`/`caller` для каждого AI-вызова во всей игре (бой, NPC-чат, нарратив, dream_ai, диалоги, ai-test), без необходимости трогать сами вызывающие места.

---

## server/engine/event_engine.js — События

### `resolveEvent(eventId, sess) → actions[]`

Читает определение из `EVENT[eventId]`:

1. Проверяет `once` через `player.storyFlags['event_fired_<id>']`.
2. Для каждого `action`: `if`, блок `select` (первый подходящий вариант).
3. Серверно: `set`, цепочка `event` (рекурсия с защитой от циклов).
4. Клиенту возвращает плоский список: `{ type, value }` где `type ∈ video | sound | music | narrator | dialogue`.

Клиент (`public/js/event.js`) выполняет actions последовательно.

---

## server/routes/

Порядок подключения в `server.js`: `meta` → `ai` → `dev` → `game` → `inventory` → `combat` → `npc` → `event` → `dialogue` → `scavenge` (в `app/electron/main.js` — тот же порядок).

| Файл | Эндпоинты |
|------|-----------|
| `game.js` | `GET /api/session`, `POST /api/new-game`, `POST /api/quit`, `POST /api/move`, `POST /api/interact`, `POST /api/save`, `POST /api/load` |
| `ai.js` | `POST /api/ai-check`, `POST /api/ai-test-step`, `POST /api/ai-rate` |
| `dev.js` | `GET /api/dev/status`, `GET /api/dev/log`, `POST /api/dev/log/clear` — см. [devlog.js](#serverenginedevlogjs--dev-режим-и-лог-ai-вызовов); 404 на последних двух, если процесс не запущен с `-developer` |
| `combat.js` | `POST /api/narrate`, `POST /api/combat/turn`, `POST /api/combat/flee`, `POST /api/combat/mercy` |
| `inventory.js` | `POST /api/equip`, `POST /api/unequip`, `POST /api/use-item`, `POST /api/skill/learn` |
| `npc.js` | `POST /api/npc/interact`, `POST /api/npc/chat`, `POST /api/npc/attack`, `POST /api/npc/close`, `POST /api/npc/trade/buy`, `POST /api/npc/trade/sell` |
| `event.js` | `POST /api/event/fire` |
| `dialogue.js` | `POST /api/dialogue/start`, `POST /api/dialogue/advance`, `POST /api/dialogue/close` |
| `scavenge.js` | `GET /api/scavenge/scene`, `POST /api/scavenge/interact`, `POST /api/scavenge/open-event` — см. [scavenge.md](scavenge.md) |
| `meta.js` | `GET/POST /api/settings`, `GET /api/saves`, `DELETE /api/saves/:id`, `GET /api/skills`, `GET /api/skills-config`, `GET /api/skills-i18n`, `GET /api/journal`, `GET /api/languages`, `POST /api/language`, `GET /api/ui-strings`, `GET /api/ui-sounds`, `GET /api/media`, `GET /api/equip-config`, `GET /api/combat-config`, `GET /api/music-tracks`, `GET /api/preload-assets`, `GET /api/manifesto` |

Подробные тела запросов и ответов — в [api.md](api.md).
