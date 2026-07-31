# Манифесты

Все данные игры описаны в JSON-манифестах в папке `assets/`. Сервер загружает их один раз при старте (`server/engine/data.js`). Чтобы изменения вступили в силу — перезапустить сервер.

---

## Формат `level` (общий для всех манифестов)

Поле `level` указывает, на каких уровнях подземелья данный элемент доступен:

| Формат | Пример | Расшифровка |
|--------|--------|-------------|
| Число | `1` | Только уровень 1 |
| Массив чисел | `[1, 2, 3]` | Уровни 1, 2 и 3 |
| Строка-диапазон | `"1-5"` | Уровни 1–5 включительно |
| Массив смешанный | `["1-5", 8]` | Уровни 1–5 и уровень 8 |
| `null` / отсутствует | — | Любой уровень |

**Фолбэк:** если для запрошенного уровня нет подходящего контента, сервер ищет ближайший доступный уровень ниже (`resolveMapLevel` / `resolveMobLevel`).

---

## `assets/player.json` — Игрок

Базовый шаблон игрока. Используется при создании новой игры.

```jsonc
{
  "id": "player",
  "hp": 100,       // Базовое максимальное HP
  "energy": 100,   // Базовая максимальная энергия

  // Базовые значения пассивных характеристик (по умолчанию 0)
  "stats": {
    "armor": 0,
    "magical_armor": 0,
    "avoidance": 0,
    "physique": 0,
    "power": 0,
    "agility": 0,
    "intelligence": 0
  },

  "imags": {
    "default":         "player/Player_animated.webp",
    "attack":          "player/Player_attack.png",
    "defend":          "player/Player_defend.png",
    "dead":            "player/Player_dead.png",
    "magical_attack":  "player/Player_magical_attack.png",
    "effects": {
      "heal": "player/effects/heal.png",  // Оверлей при исцелении
      "crit": "player/effects/crit.png"   // Оверлей при крите на противнике
    }
  },

  "pawn": "player/pawn.png",  // Пешка на тайловой карте

  // Звук: необязательные поля
  "sound": {
    "attack": { "hit": "ui/sword/1.mp3", "crit": "ui/sword/critical/1.mp3" }
  },
  "sound_volume": 1.0,        // Мультипликатор для всех звуков игрока

  "function": {
    "attack": {
      "int": 20,
      "chance_critical": 0.05,
      "multiplier_critical": 0.3,
      "energy_cost": 20,
      "action": true
    },
    "defend": { "int": 30, "energy_cost": 15, "action": true },
    "wait":   { "int": 25, "action": true },
    "heal":   { "int": 25, "energy_cost": 20, "action": true, "loop": 3 }
  }
}
```

**`action: true` в `function`:** регистрирует способность как доступную по умолчанию — без `required` в core. Способности с `action: false` (или без поля) не появятся в бою.

**Звуковые поля:**
- `sound` — карта звуков по ability id (необязательно). Формат аналогичен entity-карте в sfx.js.
- `sound_volume` — мультипликатор громкости для всех звуков игрока (необязательно).

Если `sound` / `sound_volume` не указаны, sfx.js использует звуки из `core.json` и `default_sound_volume`.

---

## `assets/config/progression.json` — Таблица прогрессии

Массив уровней персонажа. XP накапливается убийством мобов.

```jsonc
[
  { "level": 1, "xpRequired": 0,    "skillPoints": 0 },
  { "level": 2, "xpRequired": 80,   "skillPoints": 1, "grants": { "stats:physique:int": 1 } },
  { "level": 3, "xpRequired": 200,  "skillPoints": 1 },
  { "level": 4, "xpRequired": 380,  "skillPoints": 2, "grants": { "stats:power:int": 1 } },
  ...
]
```

**Поля:**
- `level` — номер уровня персонажа
- `xpRequired` — минимальный накопленный XP
- `skillPoints` — очки навыков при достижении этого уровня
- `grants` *(необязательно)* — автоматические бонусы к характеристикам при достижении уровня

**Формат `grants`:** объект `{ "connect-path": value }` — те же ключи, что и в `function.mode[].connect` навыков. Накапливаются в `player.levelBonuses` и применяются через `recalcStats()`.

```jsonc
"grants": {
  "stats:power:int": 2,
  "stats:physique:int": 2
}
```

---

## `assets/mob/manifesto.json` — Мобы

Массив шаблонов мобов. Каждый используется для `spawnMob(level)`.

```jsonc
[
  {
    "id": "skeleton1",
    "name": "Скелет (новичок)",
    "weight": 10,                  // Вес для взвешенного рандома (по умолчанию 1)
    "promt": "Не говорит, скрежещит костями...",
    "random_spawn": true,          // false = не спавнится случайно

    "imags": {
      "default": "skeleton/skeleton.png",
      "attack":  "skeleton/skeleton_attack.png",
      "dead":    "skeleton/skeleton_dead.png",
      "effects": {
        "attack": "skeleton/effects/attack_hit.png",
        "crit":   "skeleton/effects/crit.png"
      }
    },

    "level": ["1-15"],

    "multiplier": {
      "hp":    1.2,
      "xp":    1.1,
      "attack": 1.15,
      "stats": { "armor": 1.05 }
    },

    "stats": {
      "armor":    5,
      "avoidance": 0.1
    },

    "xp": 25,
    "hp": 25,
    "energy": 70,

    "surrender_difficulty": 0.55,

    // Звук: необязательные поля
    "sound": {
      "damage_received": {
        "hit":  "mob/skeleton/hit.mp3",
        "crit": "mob/skeleton/crit_hit.mp3"
      }
    },
    "sound_volume": 0.9,          // Мультипликатор громкости для этого моба

    "function": {
      "attack": { "int": 15, "chance_critical": 0.05, "multiplier_critical": 0.2, "action": true },
      "wait":   { "int": 20, "action": true },
      "heal":   { "int": 0,  "action": false }
    },

    "items": [
      { "id": "gold", "count": [2, 8], "chance": 1.0 }
    ]
  }
]
```

**Масштабирование `multiplier`:**

| Форма | Пример | Поведение |
|-------|--------|-----------|
| Число | `1.2` | Масштабирует HP, XP, все `function[id].int` |
| Объект | `{ "hp": 1.1, "xp": 1.1 }` | Только указанные ключи |
| Объект + `stats` | `{ "hp": 1.1, "stats": { "armor": 1.05 } }` | `stats` — вложенный объект для пассивных характеристик |

Формула: `base * m^(level-1)`. При level=1 множитель = 1.

**Звуковые поля:**
- `sound.damage_received` — звук, когда игрок попадает по мобу (без block). Используется `sfx.playDamageReceived()`.
- `sound_volume` — мультипликатор громкости (переопределяет `default_sound_volume`).

**Выбор при спавне:** фильтр по уровню → взвешенный рандом по `weight`.

### Поле `encounter_text` (нарратив перед боем)

Необязательное поле. Если указано — переопределяет глобальный `beffore_combat` из `narrative.json` для этого конкретного моба.

```jsonc
"encounter_text": {
  "default": "Скелет поднялся из-под земли.",
  "is_ai": true,
  "variants": [
    {
      "key": "encounter_berserk",       // Ключ в файле перевода моба
      "if": ["condition:berserk"],
      "text": "Скелет почуял кровь и бросился вперёд.",
      "is_ai": true
    }
  ]
}
```

Подробнее — в [narrative.md](narrative.md).

---

### Механика сдачи (`surrender_difficulty`)

`surrender` появляется только если игрок написал сообщение в этом ходу И выполнен порог слабости:

```jsonc
// Простая форма: только порог HP
"surrender_difficulty": 0.55
// surrender когда mob.hp / mob.maxHp < (1 − 0.55) = 45%

// Объектная форма: оба условия одновременно
"surrender_difficulty": { "hp": 0.85, "energy": 0.80 }
// surrender когда hp < 15% И energy < 20%
```

---

### Скрипты (`script`) — условные изменения и поведение

Необязательный массив скриптов, которые выполняются **при спавне моба**. Условия `if` вычисляются относительно состояния игрока в момент генерации этажа (убийства, карма, флаги и т.д.).

#### `type: "edit"` — условный патч параметров

Применяет deep-merge к дефиниции моба **до** применения `multiplier`. Все патчи из всех совпавших записей применяются последовательно.

```jsonc
"script": [
  {
    "type": "edit",
    "if": ["condition:berserk"],
    "edit": [
      { "surrender_difficulty": { "hp": 0.55 } }
    ]
  },
  {
    "type": "edit",
    "if": ["condition:karma_good"],
    "edit": [
      { "xp": 30, "hp": 15 }
    ]
  }
]
```

**Важно:** если скрипт меняет `xp: 30`, а `multiplier.xp: 1.02` — итоговый XP = `round(30 × 1.02^(level−1))`. Multiplier всегда применяется к уже отредактированному базовому значению.

Поддерживаемые поля для патча: `surrender_difficulty`, `xp`, `hp`, `energy`, `multiplier`, `function` (способности моба), `items`, `weight` — любое поле дефиниции моба.

#### `type: "ai_surrender"` — убеждение через AI *(необязательно)*

Позволяет игроку уговорить моба сдаться через диалог **до** того как тот ослабеет, — но только если аргументы резонируют с личностью и желаниями конкретного моба.

```jsonc
{
  "type": "ai_surrender",
  "if": [],                   // Условия активации (пустой = всегда)
  "min_msg_length": 20,       // Минимальная длина сообщения игрока (по умолчанию 20)
  "hint": "Он жаждет покоя — реагирует на обещание прекратить страдания."
          // hint (необязательно): уточняет AI-классификатору что именно трогает этого моба
}
```

**Как работает:** если условия `if` совпали и сообщение игрока ≥ `min_msg_length` → отдельный AI-вызов анализирует, резонирует ли сообщение с личностью (`promt`) и `hint` моба. Если да — `surrender` добавляется в доступные действия, и в тёрн-сообщение моба добавляется подсказка что противник хочет мира. Моб сам решает — выбрать `surrender` или нет, согласно своему характеру.

**Отличие от обычной сдачи:** `surrender_difficulty` открывает сдачу через урон HP/энергии. `ai_surrender` — альтернативный путь через убеждение словами. Оба механизма независимы, можно использовать любой или оба.

> Мобы без `script` или без `ai_surrender` сдаются только через `surrender_difficulty` — это стандартное поведение.

---

## `assets/boss/manifesto.json` — Боссы

Массив шаблонов боссов. Структура аналогична мобам, но с поддержкой **фаз**.

```jsonc
[
  {
    "id": "skeleton_golem",
    "name": "Скелет-Голем",

    // Промт может быть объектом с несколькими разделами
    "promt": {
      "general":            "...",
      "soul":               "...",
      "behavior":           "...",
      "communication_style":"..."
    },

    "imags": {
      "default": "skeleton_golem/skeleton_golem.webp",
      "attack":  "skeleton_golem/skeleton_golem_attack.png",
      "dead":    "skeleton_golem/skeleton_golem_dead.png",
      "effects": {
        "attack": {
          "hit":  "skeleton_golem/effects/attack.png",
          "crit": "skeleton_golem/effects/attack.png"
        }
      }
    },

    // Визуальный стиль (цвет тени)
    "style": {
      "shadow_color":   "#3E5B18",
      "shadow_opacity": 0.3
    },

    "level": ["5"],
    "count": 1,              // Максимум спавнов на этаж

    "multiplier": { "xp": 1.05, "hp": 1.05, "attack": 1.01 },

    "stats": { "armor": 5 },
    "xp": 120, "hp": 100, "energy": 100,

    "surrender_difficulty": { "hp": 0.95, "energy": 0.95 },

    "encounter_text": {
      "is_ai": true,
      "default": "{mob_name} возник из тьмы...",
      "variants": [
        {
          "priority": 10,
          "if": ["condition:berserk"],
          "key": "encounter_berserk_rage",
          "text": "{mob_name} взревел...",
          "is_ai": true
        },
        {
          "priority": 5,
          "extension": true,        // Добавляется к основному тексту
          "if": [["player:hp", "<", ["player:maxHp", "*", 0.3]]],
          "key": "encounter_weak_opponent",
          "text": "{mob_name} замечает твою слабость...",
          "is_ai": true
        }
      ]
    },

    "function": {
      "attack": { "int": 25, "chance_critical": 0.4, "multiplier_critical": 0.15, "action": true },
      "defend": { "int": 140, "action": true },
      "wait":   { "int": 25, "action": true },
      "heal":   { "int": 0,  "action": false }
    },

    "items": [{ "id": "gold", "count": 1, "chance": 0.5 }],

    // Фазы — переходы при выполнении условий
    "phase": [
      {
        "phase": 1,
        "phase_name": "Rage",
        "if": ["mob:hp", "<", ["mob:maxHp", "*", 0.5]],
        "style":    { "shadow_opacity": 0.4 },
        "imags":    { "attack": "skeleton_golem/skeleton_golem_attack.png" },
        "stats":    { "armor": 15 },
        "function": {
          "attack": { "int": 30, "chance_critical": 0.5, "multiplier_critical": 0.15 }
        }
      }
    ]
  }
]
```

### Отличия боссов от мобов

| Параметр | Моб | Босс |
|----------|-----|------|
| Манифест | `mob/manifesto.json` | `boss/manifesto.json` |
| Спрайты | `/assets/mob/` | `/assets/boss/` |
| Флаг в runtime | `isBoss: false` | `isBoss: true` |
| Поле `pubRoom` | `hasMob: true` | `hasMob: true` + `hasBoss: true` |
| Фазы | нет | `phase[]` |
| Промт | строка | строка или объект с разделами |

### Система фаз

Фаза описывает **изменение состояния** босса при выполнении условия `if`.

**Условие `if`:**
```jsonc
// Прямое сравнение
["mob:hp", "<", ["mob:maxHp", "*", 0.5]]   // hp < maxHp * 0.5

// AND-массив условий
[["mob:hp", "<", 50], ["player:hp", "<", 30]]

// Ссылки: mob:field или player:field
["mob:maxHp", "*", 0.5]   // вычисляемое правое значение
```

**Поля фазы (все необязательны):**

| Поле | Поведение |
|------|-----------|
| `style` | Deep-merge в `boss.style` |
| `imags` | Deep-merge в `boss.imags` |
| `energy` | Заменяет `boss.maxEnergy`, energy clamp'ится |
| `stats` | Patch-мердж в `boss.stats`, масштабируется через `multiplier.stats` |
| `function` | Patch-мердж способностей, `int` масштабируется через `multiplier[abilId]` |

Фазы **необратимы** — однажды сработав, применяются навсегда (до конца боя).

### Encounter text боссов

Поддерживает дополнительные поля по сравнению с мобами:
- `priority` — числовой приоритет варианта (выше → предпочтительнее)
- `extension: true` — вариант **добавляется** к выбранному основному тексту (не заменяет)

---

## `assets/item/manifesto.json` — Предметы и объекты

### Раздел `items`

```jsonc
{
  "items": [
    {
      "id": "sword_iron",
      "image": "sword_iron.png",
      "name": "Железный меч",
      "inventory": true,
      "equip": "weapon",        // Слот: weapon | shield | amulet | ring
      "price_sell": 25,
      "price_buy": 100,
      "stats": {
        "ability:attack:int": 12,
        "ability:attack:chance_critical": 0.05,
        "ability:defend:int": 8,
        "player:max_hp": 25,
        "player:max_energy": 30,
        "stats:power:int": 2
      }
    },
    {
      "id": "elixir_healing",
      "image": "elixir_healing.png",
      "name": "Эликсир исцеления",
      "inventory": true,
      "equip": false,
      "inventorybar": true,
      "use": {
        "out_combat": { "hp": 50 },
        "in_combat":  { "hp": 60 }
      }
    }
  ]
}
```

**Слоты экипировки:** `weapon`, `shield`, `amulet`, `ring`. При надевании нового предмета старый возвращается в инвентарь.

**Эликсиры в бою:** только один за ход (`elixirUsedThisTurn`).

### Раздел `object`

```jsonc
{
  "object": [
    {
      "id": "chest_1",
      "name": "Сундук",
      "image": "chest.png",
      "action": "chest",
      "items": [
        { "id": "gold",           "count": [2, 11], "chance": 1.0  },
        { "id": "elixir_healing", "count": 1,       "chance": 0.15 }
      ],
      "spawn": "1-3"
    }
  ]
}
```

| `action` | `interactType` | Поведение |
|----------|----------------|-----------|
| `door` | `"door"` | Требует ключ; создаёт подземелье level+1 |
| `pickup` / `items` | `"item"` / `"key"` | Немедленно → инвентарь, объект удаляется |
| `chest` | `"chest"` | Рандомный лут по `chance`; открывается один раз |

---

## `assets/map/manifesto.json` — Карта подземелья

### Секции (`section`)

```jsonc
{
  "id": "5",
  "level": [1, 2, 3],
  "action": "generation",     // "generation" | "spawn"
  "image": "block_[t_b_l_r].png",
  "chance_spawn_npc": 0.3,
  "spawn_npc": ["man_bandages"],
  "passage": { "left": true, "right": true, "top": true, "bottom": true }
}
```

**`action: "spawn"`** — стартовая комната уровня.

### Переходы (`transition`)

Визуальные коридоры между комнатами. `passage: "X"` — горизонтальный, `passage: "Y"` — вертикальный. Не влияют на генерацию.

---

## `assets/config/dungeon_levels.json` — Конфигурация этажей

```jsonc
{
  "default": { "min": 8, "max": 14 },
  "1": { "plan": ["level_plan/map_level_1_1.json"] },
  "2-4":  { "min": 8,  "max": 10 },
  "5-15": { "min": 10, "max": 18 }
}
```

`plan` — заранее собранная карта (выбирается случайно из массива). `min`/`max` — процедурная генерация.

---

## `assets/npc/manifesto.json` — NPC

```jsonc
[
  {
    "id": "man_bandages",
    "name": "Безымянный торговец",
    "level": ["2-4"],
    "promt": "...",
    "max_count_message": 8,
    "message_ignores": "Он ничего не говорит",
    "type": "trader",
    "portrait": "portrait/man_bandages.png",
    "pawn": "man_bandages_pawn.png",
    "icon": "icon/man_bandages.png",
    "count_spawn_level": 1,
    "trader": [
      { "item": "elixir_healing", "count": "1-3", "chance_appearance": 0.8, "discount": 0.05 }
    ]
  }
]
```

Цена покупки: `round(item.price_buy * (1 - discount))`.

### Бой, отношение и память NPC (`npc_combat`, `relationship`, `dream_ai`)

NPC может дополнительно нести поля `npc_combat`, `combat`, `relationship`, `dream_ai` — включает возможность подраться с ним (он временно превращается в моба/босса по шаблону), кросс-сейв или сессионное отношение и AI-память. Подробно и с примером — в отдельном документе: **[npc_combat.md](npc_combat.md)**.

### `knows_lore` — условный поиск по лору в свободном чате

```jsonc
{
  "id": "man_bandages",
  ...
  "knows_lore": [
    "god_denecess",
    "lux_aeterna",
    { "id": "one_lost_history", "if": [], "remember": true }
  ]
}
```

Список тем из `assets/config/lore.json` (`key: {path, description}`), к которым у ЭТОГО NPC есть доступ — не все NPC должны знать всё. Каждая запись — либо просто строка-ключ (всегда доступна, `remember: true` по умолчанию), либо объект:

- `if` — условия входа, тот же синтаксис что в `dialogue.json`/`event.json` (`evalAll`). Пусто/нет поля — доступно всегда.
- `remember` (по умолчанию `true`) — держать результат поиска в ЖИВОЙ истории чата (`npc.history`) до конца текущей сессии диалога, чтобы на следующее сообщение модель не «забывала», что уже это узнавала, и не дёргала поиск заново. Это НЕ долгосрочная кросс-сессионная память (`npc.memory`/`dream_ai`) — только пока открыт этот конкретный чат.

Модель сама решает, нужен ли ей контекст по теме, чтобы ответить — если да, сервер догружает текст темы (`assets/translation/{lang}/promts/lore/<path>`) и переспрашивает модель ОДИН раз с этим контекстом. Тема, которой нет среди доступных этому NPC прямо сейчас (не в `knows_lore`, либо `if` не прошло, в т.ч. если модель «придумала» несуществующую), тихо игнорируется — используется ответ без лора (либо форсируется ещё один plain-запрос, если первый ответ пуст — см. `runToolTurn`).

Два механизма, выбор автоматический за игру не отвечает:

- **Native tool calling** (приоритетно) — если для текущего провайдера/модели пройден `tools`-степ теста в настройках (`aiTestTools` → `markToolsSupported`), тема передаётся как отдельный tool `lore_lookup` с `enum` из доступных ключей — модель либо вызывает тул, либо просто отвечает. Движок: `server/engine/tools.js` (`buildSingleParamTool`/`runToolTurn`, провайдеро-независимый адаптер, годится и для будущих тулов вроде покупки через диалог).
- **JSON-mode fallback** — если tools не поддержаны/не пройдены, но включён `ollamaJsonMode`/`openrouterJsonMode`: условное поле `lore_topic` прямо в JSON-ответе (`null`, если не нужно).

При `remember: true` и успешном поиске в `npc.history` попадает не только финальная реплика, но и сам факт поиска (tool_call+tool_result у native tools, системное сообщение с текстом темы у JSON-fallback) — поэтому обрезка истории (`_trimNpcHistory` в `routes/npc.js`) режет по границе `user`-сообщений (целыми «ходами»), а не фиксированной парой, чтобы не оторвать `tool`-сообщение от его `assistant`-владельца.

Движок: `server/engine/npc.js` (`npcSystempromt`/`parseNpcReply`/`lookupLore`/`npcLoreTopics`), `server/routes/npc.js` (`/api/npc/chat` — там же выбор между двумя механизмами).

---

## `assets/skills/manifesto.json` — Дерево навыков

```jsonc
{
  "battle": [
    {
      "id": "bt_p1",
      "type": "point",
      "name": "Острый взгляд",
      "description": "+2 к атаке",
      "uses_point": 1,
      "requires": [],
      "position": { "x": 210, "y": 40 },
      "function": {
        "mode": [
          { "connect": "ability:attack:int",             "value": 2    },
          { "connect": "ability:attack:chance_critical", "value": 0.03 },
          { "connect": "player:max_hp",                  "value": 10   },
          { "connect": "stats:power:int",                "value": 2    }
        ]
      }
    }
  ],
  "survival": [...],
  "magic":    []
}
```

**Типы узлов:** `point` (малый), `notables` (ключевой, требует `images.active`/`images.disabled`).

**Формат `mode[].connect`:**

| Префикс | Что меняет | Пример |
|---------|-----------|--------|
| `ability:<id>:int` | Базовое значение способности | `ability:attack:int` |
| `ability:<id>:chance_critical` | Шанс крита способности | `ability:attack:chance_critical` |
| `ability:<id>:multiplier_critical` | Множитель крита | `ability:attack:multiplier_critical` |
| `player:max_hp` | Максимальное HP | — |
| `player:max_energy` | Максимальная энергия | — |
| `stats:<id>:int` | Пассивная характеристика | `stats:power:int` |

Бонусы накапливаются аддитивно. Все три источника (навыки, экипировка, level grants) используют одни и те же connect-пути и применяются в `recalcStats()`.

---

## `assets/config/narrative.json` — Система нарратива

Управляет AI-рассказчиком. При отсутствии файла или `"narrative": false` — система отключена.

```jsonc
{
  "narrative": true,

  "beffore_combat": {
    "active": true,
    "is_ai": true,
    "path_promt_narrator": "assets/translation/{lang}/promts/narrator_combat.md",
    "default": "Неожиданная встреча с {mob_name}.",
    "variants": [...]
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
    "trader": { "active": true, "is_ai": true, "path_promt_narrator_combat": "...", ... },
    "other":  { "active": true, "is_ai": true, "path_promt_narrator_combat": "...", ... }
  }
}
```

`after_defeat` — отдельный текст после **поражения игрока** (в паре с `after_combat`, который показывается после победы). `path_promt_narrator_combat` у `NPC.trader`/`NPC.other` — промт для боя с этим NPC как с противником ([npc_combat.md](npc_combat.md)), вместо обычного `path_promt_narrator`.

Полная документация — в [narrative.md](narrative.md).

---

## `assets/config/core.json` — Боевая система

Декларативное описание всей боевой механики. Подробно описан в [combat_system.md](combat_system.md).

Ключевые секции:
- `battle_queue` — режим анимации (`"together"`)
- `default_sound` — глобальный fallback-звук для способностей
- `default_sound_volume` — мастер-мультипликатор громкости (0–2)
- `default_sound_mob` — глобальные звуки мобов `{ dead, damage_received: { hit, crit } }`
- `stats` — пассивные характеристики и их влияние
- `ability` — активные способности (с полями `sound`, `sound_volume`)
- `effects` — статус-эффекты
- `function_only_player` — действия только для игрока (например, `flee`)

---

## `assets/config/ai_test.json` — Тест доступности AI

Настройки для кнопки «Проверить модель» в настройках провайдера и для входного гейта `/api/ai-check`. Не влияет на игровые AI-запросы напрямую — только на то, как оценивается и подписывается результат самотеста модели.

```jsonc
{
  "speed_ms": {
    "excellent": 3000,
    "good":      8000,
    "fair":      15000
  },
  "score_all_passed_base":         70,
  "score_all_passed_speed_weight": 30,
  "score_partial_multiplier":      60,
  "ratings": [
    { "key": "excellent", "min_score": 90 },
    { "key": "good",      "min_score": 70 },
    { "key": "fair",      "min_score": 40 },
    { "key": "poor",      "min_score": 0  }
  ]
}
```

**Поля:**

| Поле | Тип | Описание |
|------|-----|----------|
| `speed_ms.excellent` | number | Средняя задержка (мс) теста, при которой спид-скор = `1` |
| `speed_ms.good` | number | Порог, ниже которого спид-скор = `0.7` (иначе `0.4`, либо `0.15` при задержке выше `fair`) |
| `speed_ms.fair` | number | Верхний порог для спид-скора `0.4`; выше — `0.15` |
| `score_all_passed_base` | number | Базовый итоговый балл, если пройдены все шаги теста |
| `score_all_passed_speed_weight` | number | Вес, с которым спид-скор добавляется к базовому баллу (`score = base + speedScore * weight`) |
| `score_partial_multiplier` | number | Множитель для случая, когда пройдены не все шаги: `score = round(passed / total * multiplier)` |
| `ratings` | array | Тиры рейтинга `{ key, min_score }`; берётся тир с наибольшим `min_score`, не превышающим итоговый балл (сортировка по убыванию `min_score`, фолбэк — последний/самый низкий тир) |

**Шаги теста** (`server/engine/ai.js`, три независимых самотеста модели, каждый гоняется через `POST /api/ai-test-step { step }`):

| `step` | Проверяет |
|--------|-----------|
| `basic` | Провайдер вообще отвечает (`PONG` на пинг) |
| `combat` | Модель отвечает в боевом формате (`ACTION`/`SPEECH`/`NOTES` или JSON-аналог) и выбирает валидное действие |
| `perception` | Модель корректно интерпретирует явные боевые цифры как структурированный JSON (аналог классификатора убеждения) |

Результаты шагов (`{ id, ok, ms, detail }`) клиент копит и отправляет в `POST /api/ai-rate { results }` → сервер считает `score`/`ratingKey`/`avgMs` через `rateAiResults()` по формулам выше. Если все шаги прошли — текущие настройки формы также помечаются проверенными (`markAiVerified()`), удовлетворяя входной гейт `/api/ai-check`.

**Связь с `core.json`:** `POST /api/ai-check` требует пройденный `basic`-тест только если в `core.json` указано `start_game.required_ai_system: true`; при `false` эндпоинт сразу отвечает `{ ok: true, required: false }` без обращения к провайдеру. Верификация кэшируется на время жизни процесса и автоматически сбрасывается при смене провайдера/модели/URL/ключей (сигнатура настроек).

---

## `assets/config/media.json` — Реестр медиа

Единый файл: UI-звуки (`sound`), музыка для событий (`music`), видео (`video`).

- Клиент UI: `GET /api/ui-sounds` → секция `sound`.
- Клиент событий: `GET /api/media` → полный объект.
- события (`assets/event/*.json`) ссылаются на ключи из `sound` / `music` / `video`.

```jsonc
{
  "sound": {
    "dungeon_move": { "src": "ui/dungeon_room.mp3", "volume": 0.8 },
    "chest_open":   "ui/default_stub.mp3",
    "item_pickup":  "ui/default_stub.mp3"
  },
  "music": {
    "tension": { "src": "battle/fight1.mp3", "loop": true }
  },
  "video": {
    "intro": { "src": "cinematics/intro.webm", "skippable": true }
  }
}
```

**Форматы `sound` / `music`:** `null`, строка, массив строк, `{ src, volume [, loop] }`.  
Пути относительно `/assets/sound/` (видео — `/assets/video/`).

Добавление UI-звука: ключ в `sound` + `sfx.playUi('key')` — перезапуск сервера не нужен (клиент грузит при старте).

Подробнее — [sound.md](sound.md).

---

## `assets/config/dialogue.json` — Сценарные диалоги

Словарь диалогов по `id`. Каждый диалог может содержать:

- `before` / `script` / `outro` — фазы с массивом узлов `{ id, text, text_key, is_ai, ai_hint, speaker, choices[], next, set }`
- `if` — условия входа (как в `conditions.json`)
- `ends_with` на последнем узле — подсказка клиенту

Тексты: `assets/translation/{lang}/dialogue.json` или `text_key: "dialogue.<id>.<field>"`.

API: [api.md](api.md#сценарный-диалог). Движок: `server/engine/dialogue.js`.

---

## `assets/event/*.json` — Сюжетные события

Список файлов — `assets/event/manifesto.json` (тот же split-формат, что у `assets/dialogue/manifesto.json`: массив имён файлов, каждый файл — словарь событий по `id`, все мержатся в один объект `EVENT`). `assets/config/event.json` теперь только документация формата — рантайм его не читает.

Словарь событий по `id`:

```jsonc
"floor2_intro": {
  "once": true,
  "actions": [
    { "if": [], "sound": "event_sting" },
    { "select": [
      { "if": ["storyFlag:met_npc"], "dialogue": "alt_path" },
      { "dialogue": "default_path" }
    ]},
    { "set": { "storyFlag:seen_intro": true } },
    { "event": "chained_event_id" }
  ]
}
```

Сервер: `resolveEvent()` → список client actions. Клиент: `fireEvent()` в `event.js`.

---

## Scavenge (обыск комнаты)

Сцены, привязка к `map/manifesto.json`, API и клиент — в [scavenge.md](scavenge.md).
