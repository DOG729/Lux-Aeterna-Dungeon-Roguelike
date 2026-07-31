# Боевая система

Описывается через `assets/config/core.json`. Всё поведение декларативно — новые действия и механики добавляются без правки кода движка.

## Структура core.json

```
combat_system/
  battle_queue    — режим анимации хода
  default_sound         — глобальный fallback-звук
  default_sound_volume  — мастер-мультипликатор громкости
  default_sound_mob     — глобальные звуки мобов
  stats/          — пассивные характеристики и атрибуты персонажа
  ability/        — активные боевые способности (с полями sound, sound_volume)
  effects/        — статус-эффекты (DoT, баффы, дебаффы)
  function_only_player/ — действия только для игрока
  end_combat/       — восстановление HP/energy/mana после боя
```

---

## `end_combat`

Восстановление после победы или mercy (не после побега). Формула для каждого ресурса:

```
new = min(max, floor(max * refresh_pct + current * leftover_mult))
```

```json
"end_combat": {
  "energy": { "refresh_pct": 0.8, "leftover_mult": 0.5 },
  "hp":     { "refresh_pct": 0.05, "leftover_mult": 1 },
  "mana":   { "refresh_pct": 0, "leftover_mult": 0 }
}
```

- `refresh_pct` — доля от максимума («отдышка»).
- `leftover_mult` — множитель на остаток в полоске в конце боя.

Реализация: `server/engine/player.js` → `applyEndCombatRefresh()`.

---

## `battle_queue`

```json
"battle_queue": "together"
```

Определяет режим расчёта хода. Сейчас поддерживается `"together"` — оба действия выполняются в один ход. Значение используется как ключ для выборки конфигурации анимации из `assets/config/combat.json`.

---

## Звуковые поля верхнего уровня

```json
"default_sound": "ui/soft_RPG_interface.mp3",
"default_sound_volume": 0.8,
"default_sound_mob": {
  "dead": null,
  "damage_received": {
    "hit":  null,
    "crit": null
  }
}
```

| Поле | Описание |
|------|----------|
| `default_sound` | Fallback-звук для способностей без собственного звука |
| `default_sound_volume` | Мастер-мультипликатор: `finalVol = userSlider × soundVolume`. Диапазон 0–2. При `0.8` реальный максимум = 80% от слайдера |
| `default_sound_mob.damage_received` | Звуки получения урона для всех мобов без собственного `sound.damage_received`. Форматы: `null` (тихо), строка, массив или `{ hit, crit }` |

Эти значения передаются клиенту в `pubSession` и инициализируют `sfx` через `sfx.setDefault()`, `sfx.setDefaultVolume()`, `sfx.setDefaultMobSounds()`.

---

## stats — пассивные параметры

### Защитные механики (`armor`, `magical_armor`, `avoidance`)

Пассивные характеристики, снижающие входящий урон или позволяющие уклониться.

| Поле | Описание |
|------|----------|
| `int` | Базовое значение по умолчанию (из core) |
| `impact` | Коэффициент применения |
| `applies_to_ability[]` | Против каких способностей срабатывает и с каким коэффициентом |

```json
"armor": {
  "int": 0,
  "impact": 0.5,
  "applies_to_ability": [
    { "connect": "attack",         "impact": 0.5 },
    { "connect": "magical_attack", "impact": 0.2 }
  ]
},
"avoidance": {
  "int": 0,
  "impact": 0.5
}
```

**Расчёт урона с бронёй:**
```
armor_val = floor(stats.armor * core.stats.armor.impact * armorApply.impact)
dmg = max(0, rawDmg - block - armor_val)
```

**Уклонение:** `Math.random() < stats.avoidance * core.stats.avoidance.impact` — при успехе атака полностью промахивается.

### Атрибуты (`physique`, `power`, `agility`, `intelligence`)

Характеристики персонажа, влияющие на способности и другие статы через `mode[]`.

| Поле | Описание |
|------|----------|
| `int` | Базовое значение (глобальный дефолт для всех, включая мобов) |
| `mode[]` | Список связей — на что и как влияет атрибут |

**Поля записи `mode`:**

| Поле | Описание |
|------|----------|
| `type` | `"stats"` — влияет на другой стат, `"ability"` — на способность, `"effects"` — на эффект |
| `connect` | Путь к полю: `"id:field"`, например `"attack:int"` |
| `impact` | Коэффициент: `атрибут * impact` прибавляется к полю |

```json
"power": {
  "int": 0,
  "mode": [
    { "type": "ability", "connect": "attack:int", "impact": 1 }
  ]
},
"agility": {
  "int": 0,
  "mode": [
    { "type": "stats",   "connect": "avoidance:int",              "impact": 0.2 },
    { "type": "ability", "connect": "attack:chance_critical",      "impact": 0.2 },
    { "type": "ability", "connect": "attack:multiplier_critical",  "impact": 0.2 },
    { "type": "effects", "connect": "bleeding:int",                "impact": 0.2 }
  ]
}
```

> Power 5 → attack.int +5  
> Agility 10 → avoidance +2, chance_critical +0.02, bleeding.int +2

### Ресурс `mana`

```json
"mana": { "use": false, "int": 100 }
```

`use: false` — маna отключена, все `mana_cost` игнорируются.

---

## ability — активные способности

Словарь (ключ = id). Для рендера UI конвертируется в массив через `resolveAbilities(player)`.

### Поля способности

| Поле | Описание |
|------|----------|
| `action` | Тип поведения: строка или массив шагов (pipeline) |
| `label` | Отображаемое название |
| `icon` | Путь к иконке |
| `int` | Базовое значение (урон / восстановление) |
| `energy_cost` | Стоимость в энергии |
| `mana_cost` | Стоимость в мане (если `mana.use: true`) |
| `loop` | Кулдаун в ходах |
| `default_action` | `true` → доступна всем (игроку и мобам) без явного включения |
| `applies_to[]` | Против каких способностей работает (для `damage_reduction`) |
| `chance_critical` | Шанс крита |
| `multiplier_critical` | Множитель крита |
| `required[]` | Условия разблокировки |
| `effects[]` | ID эффектов, которые вешаются на цель при попадании |
| `sound` | Звук способности (см. ниже) |
| `sound_volume` | Мультипликатор громкости этой способности (переопределяет `default_sound_volume`) |

### Поле `sound` в ability

Формат зависит от типа `action`:

**`action: "attack"`:**
```json
"sound": {
  "hit":  ["ui/sword/1.mp3", "ui/sword/2.mp3"],
  "crit": "ui/sword/critical/1.mp3"
}
```

**`action: "damage_reduction"`:**
```json
"sound": {
  "attack":         "ui/confirm.mp3",
  "magical_attack": "ui/magic/1.mp3",
  "default":        "ui/confirm.mp3"
}
```
Ключи — id атакующей способности противника; `"default"` — fallback.

**Прочие (`add_*`):**
```json
"sound": "ui/heal.mp3"
// или
"sound": ["ui/magic/1.mp3", "ui/magic/2.mp3"]
```

### Типы `action`

| action | Поведение |
|--------|-----------|
| `"attack"` | Наносит урон цели |
| `"damage_reduction"` | Блокирует входящий урон через `applies_to` |
| `"add_energy"` | Восстанавливает энергию |
| `"add_mana"` | Восстанавливает ману |
| `"add_hp"` | Восстанавливает здоровье |

### Pipeline (action как массив)

```json
"fire_combo": {
  "action": [
    { "type": "attack", "int": 30 },
    { "type": "attack", "int": 15, "condition": "on_crit", "loop": 2 },
    { "type": "add_hp", "int": 5,  "condition": "on_hit" }
  ],
  "energy_cost": 35
}
```

| condition | Триггер |
|-----------|---------|
| `"always"` | Безусловно (по умолчанию) |
| `"on_crit"` | Предыдущий шаг был критом |
| `"on_hit"` | Предыдущий шаг попал |
| `"on_miss"` | Предыдущий шаг промахнулся |
| `"hp_below:0.5"` | HP цели < 50% |

### Расчёт блока (`damage_reduction`)

```
заблочено = ability.int * applies_to[тип_атаки].impact
```

Пример с `defend.int = 30`:
- Физ атака 30 → `30 * 1.0 = 30` заблочено
- Маг атака 30 → `30 * 0.5 = 15` заблочено

### Полный расчёт урона

```
rawDmg = isCrit ? round(int * (1 + multiplier_critical)) : int
block  = противник защищался ? defendAbility.int * applies_to.impact : 0
armor  = floor(stats.armor * core.armor.impact * armorApply.impact)
dmg    = max(0, rawDmg - block - armor)
```

Уклонение проверяется до расчёта урона — при успехе весь урон отменяется.

### `required` — условия разблокировки

Все условия проверяются через AND. Если хотя бы одно не выполнено — способность не появляется в UI.

```json
"required": [
  "skill:magical_manifestation",
  "stats:intelligence:10",
  "item:magic_staff",
  "level:5"
]
```

| Формат | Проверка |
|--------|----------|
| `"skill:id"` | Персонаж изучил навык с данным id |
| `"stats:id:N"` | Значение характеристики >= N |
| `"item:id"` | Предмет с данным id экипирован |
| `"level:N"` | Уровень персонажа (`charLevel`) >= N |

В конце `resolveTurn`, после применения всего урона/лечения за ход, для боссов вызывается `checkPhases(combat, player)` — необратимый переход между фазами по условию `mob:hp`/`player:hp`. Механика фаз (условия, `applyPhase`, формат лога) целиком описана в [bosses.md](bosses.md#фазы), здесь она не дублируется.

---

## effects — статус-эффекты

```json
"effects": {
  "bleeding":  { "icon": "...", "action": "damage_per_turn", "int": 5,   "loop": 3 },
  "vampirism": { "icon": "...", "action": "lifesteal",       "int": 0.2, "exception": ["ability:defend"] },
  "poison":    { "icon": "...", "action": "damage_per_turn", "int": 8,   "loop": 4 },
  "stun":      { "icon": "...", "action": "skip_turn",                   "loop": 1,
                 "exception": ["ability:defend", "ability:magical_defend"] }
}
```

| action | Поведение |
|--------|-----------|
| `"damage_per_turn"` | Урон каждый ход |
| `"heal_per_turn"` | Лечение каждый ход |
| `"lifesteal"` | Часть урона → в HP атакующего |
| `"skip_turn"` | Пропуск хода |

Значение эффекта масштабируется атрибутами через `mode` с `type: "effects"`:

```json
{ "type": "effects", "connect": "bleeding:int", "impact": 0.2 }
```

> Agility 10 → bleeding.int +2

---

## `function_only_player` — действия только для игрока

```json
"function_only_player": {
  "flee": {
    "action": "flee",
    "label": "Побег",
    "icon": "image/abilities/escape.png",
    "energy_cost": 25,
    "chance": 0.3,
    "condition": { "hp_ratio_below": 0.3 },
    "once_per_combat": true
  }
}
```

Действия из этого раздела не отображаются мобам. Параметры `flee` читаются в `POST /api/combat/flee` (`routes/combat.js`):

- Блокируется, если `player.hp / player.maxHp >= condition.hp_ratio_below` (побег доступен только раненому игроку).
- Блокируется, если энергии меньше `energy_cost`; при попытке энергия тратится независимо от исхода.
- Шанс успеха — `chance` (`Math.random() < chance`); при успехе `combat` очищается, при провале бой продолжается.
- Одна попытка на бой обеспечивается флагом `combat.fleeAttempted` — **`once_per_combat` в конфиге сейчас не считывается кодом**, ограничение в одну попытку захардкожено в роуте, а не управляется этим полем.

---

## Сдача моба и пощада (mercy)

Помимо victory/defeat, `resolveTurn` (`server/engine/combat.js`) поддерживает третий исход — `mercy_choice`, когда моб (или игрок, добив моба почти насмерть) готов сдаться:

- `checkSurrenderReady(mob)` — сравнивает `mob.hp`/`mob.energy` с манифестным полем `surrender_difficulty`. Если это объект `{ hp, energy }` — оба порога (`mob.hp/mob.maxHp < 1 - diff.hp` И аналогично по energy) должны выполниться; если число — просто `mob.hp/mob.maxHp < 1 - diff`. Тот же формат `surrender_difficulty` в манифесте моба/босса — см. [bosses.md](bosses.md).
- `mobAvailable(mob, playerMsg, forceSurrenderReady)` добавляет псевдо-действие `"surrender"` в список доступных мобу действий, когда `checkSurrenderReady` истинно (или AI решил сдаться раньше срока — `checkAiSurrender`, не связано с NPC-боем).
- Если мобовый ход — `"surrender"`, `resolveTurn` не наносит урона, ставит `combat.pendingMercy = true` и возвращает `result: 'mercy_choice'`.
- Аналогично, если игрок добивает моба (`mob.hp <= 0`) при `canSurrender`, HP моба откатывается к `1`, и тоже возвращается `mercy_choice` — моб «на грани», но ещё жив.
- Разрешение выбора — `POST /api/combat/mercy` с `{ "choice": "spare" | "kill" }`: `spare` даёт игроку половину `xp` моба (`peacefulWins++`), `kill` — полный `xp` и дроп (как обычная победа). Для NPC-мобов (`mob.sourceNpc`) добавляются проверки `spareable`/`killable` и NPC-специфичные последствия — см. [npc_combat.md](npc_combat.md).

---

## Левелап (`checkLevelUp`)

После победы (`victory`) или разрешения `mercy` (оба исхода) вызывается `checkLevelUp(player)` (`server/engine/combat.js`):

- Проходит по `PROGRESSION` (`assets/…`), находит максимальный `tier.level`, для которого `player.xp >= tier.xpRequired`.
- Если новый уровень выше текущего `player.charLevel` — суммирует `skillPoints` и `grants` всех пройденных тиров (от `prevLevel+1` до `newLevel` включительно).
- `grants` (объект `{ statId: amount }`) накапливаются в `player.levelBonuses`, затем вызывается `recalcStats(player)`, чтобы применить их к итоговым статам.
- Ответ роута включает `reward.levelUp = { newLevel, spGained }`; в журнал добавляется запись `combat_log.levelup`.

---

## `assets/config/combat.json` — Параметры визуальных анимаций

Конфигурация анимаций клиента. Ключ верхнего уровня совпадает со значением `battle_queue` из core.

```json
{
  "together": {
    "delay_ms": 300,
    "first_action": "mob",
    "sequential": ["attack:attack"]
  }
}
```

| Поле | Описание |
|------|----------|
| `sequential[]` | Пары `"playerAction:mobAction"`, при которых анимации идут одна за другой |
| `delay_ms` | Задержка между анимациями в sequential-паре (мс) |
| `first_action` | Кто анимируется первым в sequential-паре: `"mob"` или `"player"` |

Пары вне `sequential` анимируются одновременно.

Этот файл влияет только на визуальную сторону (клиент), не на механику расчёта хода.

---

## Добавление новой способности

Только JSON — движок обработает через существующий обработчик `action`:

```json
"attack_stabbing": {
  "action": "attack",
  "required": ["skill:attack_stabbing"],
  "effects": ["bleeding"],
  "int": 15,
  "chance_critical": 0.05,
  "multiplier_critical": 0.3,
  "energy_cost": 20,
  "sound": {
    "hit":  ["ui/sword/2.mp3", "ui/sword/4.mp3"],
    "crit": "ui/sword/critical/1.mp3"
  }
}
```

## Добавление новой характеристики

1. Добавить запись в `core.json.mechanics.stats`.
2. Добавить базовое значение в `assets/player.json.stats` (для игрока).
3. Добавить `stats[id]` в mob-манифест (по желанию).
4. При необходимости — добавить `mode[]` для связи с ability/effects.

## Добавление нового UI-звука

1. Добавить ключ в `assets/config/media.json` → `sound`.
2. Вызвать `sfx.playUi('new_key')` в нужном месте JS-кода.
3. Перезапуск сервера не нужен — карта загружается клиентом при старте. 
