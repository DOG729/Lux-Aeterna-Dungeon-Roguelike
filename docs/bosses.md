# Система боссов

Боссы — особый тип противников, описанных в `assets/boss/manifesto.json`. В отличие от обычных мобов, боссы поддерживают **фазы** — динамическое изменение характеристик и поведения в ходе боя.

---

## Отличия от мобов

| Параметр | Моб | Босс |
|----------|-----|------|
| Манифест | `mob/manifesto.json` | `boss/manifesto.json` |
| Спрайты | `/assets/mob/` | `/assets/boss/` |
| Флаг в runtime | `isBoss: false` | `isBoss: true` |
| Поле `pubRoom` | `hasMob: true` | `hasMob: true` + `hasBoss: true` |
| Фазы | — | `phase[]` (необратимые) |
| Промт | строка | строка или объект с разделами |
| Расстановка | шанс на любой комнате | специальная комната (`count`) |

---

## Структура манифеста

```jsonc
[
  {
    "id": "skeleton_golem",
    "name": "Скелет-Голем",

    // Промт может быть объектом (разделы объединяются в системный промт)
    "promt": {
      "general":            "Описание существа",
      "soul":               "История и природа",
      "behavior":           "Тактика в бою",
      "communication_style":"Как говорит/молчит"
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

    "style": {
      "shadow_color":   "#3E5B18",  // CSS-цвет тени
      "shadow_opacity": 0.3         // Начальная прозрачность тени
    },

    "level": ["5"],   // На каких этажах появляется
    "count": 1,       // Максимум экземпляров на этаж

    "multiplier": { "xp": 1.05, "hp": 1.05, "attack": 1.01 },
    "stats":      { "armor": 5 },
    "xp": 120, "hp": 100, "energy": 100,

    "surrender_difficulty": { "hp": 0.95, "energy": 0.95 },

    "items": [{ "id": "gold", "count": 1, "chance": 0.5 }],

    "function": {
      "attack": { "int": 25, "chance_critical": 0.4, "multiplier_critical": 0.15,
                  "energy_cost": 20, "action": true },
      "defend": { "int": 140, "action": true },
      "wait":   { "int": 25, "action": true }
    },

    "encounter_text": {
      "is_ai": true,
      "default": "{mob_name} возник из тьмы...",
      "variants": [
        {
          "priority": 10,
          "if": ["condition:berserk"],
          "key": "encounter_berserk_rage",
          "text": "Текст при берсерке",
          "is_ai": true
        },
        {
          "priority": 5,
          "extension": true,
          "if": [["player:hp", "<", ["player:maxHp", "*", 0.3]]],
          "key": "encounter_weak_opponent",
          "text": "Текст-дополнение когда игрок ранен",
          "is_ai": true
        }
      ]
    },

    "phase": [
      {
        "phase": 1,
        "phase_name": "Rage",
        "if": ["mob:hp", "<", ["mob:maxHp", "*", 0.5]],
        "style":    { "shadow_opacity": 0.4 },
        "stats":    { "armor": 15 },
        "function": {
          "attack": { "int": 30, "chance_critical": 0.5, "multiplier_critical": 0.15 }
        }
      }
    ]
  }
]
```

---

## Создание экземпляра (`server/engine/boss.js`)

```js
spawnBoss(bossId, level = 1)        // ищет base в BOSSES, делегирует buildBossFromBase
buildBossFromBase(base, level = 1)  // собирает боевой экземпляр из (возможно уже патченного) манифеста
```

`buildBossFromBase` — общий «сборщик» экземпляра, зеркалит `buildMobFromBase` из `mob.js`: считает статы (`resolveMobStats`/`applyStatModes`), способности (`resolveMobAbilities`), масштабирует `hp`/`xp` через `multiplier`, переводит имя/промт/`encounter_text`, резолвит `phases` (`resolvePhases`, см. ниже).

Помимо обычного спавна `buildBossFromBase` используется NPC-боем: `server/engine/npc.js → spawnNpcCombat` вызывает его напрямую, когда `combat.template.source === "boss"`, передавая уже смерженный (`deepMerge` манифеста босса + `combat.overrides`) `base` — см. [npc_combat.md](npc_combat.md) (оверлей боевого шаблона NPC, там же описан симметричный путь для мобов).

`spawnBoss` сам по себе — тонкая обёртка: находит манифест по `id` в `BOSSES` и отдаёт его в `buildBossFromBase` без какой-либо собственной логики.

### `__scriptTouchedFields` / `skipTranslation`

Проблема: когда NPC-оверлей уже явно задал поле (`name`, `promt`, `encounter_text`) через `deepMerge`, обычный перевод через `t()` внутри `buildBossFromBase` может незаметно затереть это переопределение значением из `assets/translation/…` — `t()` не знает, что поле уже было явно пропатчено выше по стеку.

Решение — `base.__scriptTouchedFields` (массив/Set имён полей, проставляется вызывающим кодом *до* вызова `buildBossFromBase`, например при `deepMerge` в `spawnNpcCombat`). Внутри `buildBossFromBase` он читается в `touched`, и для чувствительных полей выбирается один из двух путей:

| Поле | Обычный путь (не в `touched`) | Поле уже пропатчено (`touched.has(field)`) |
|------|-------------------------------|---------------------------------------------|
| `name` | `t('boss', base.id, 'name', base.name)` | `base.name` без перевода |
| `promt` | `resolvePromt('boss', base.id, base.promt)` (или `promt_path`, если задан) | `base.promt` без перевода (при отсутствии `promt_path`) |
| `encounter_text` | `translateBossEncounterText(enc, id, skipTranslation=false)` | `translateBossEncounterText(enc, id, skipTranslation=true)` |

`skipTranslation: true` в `translateBossEncounterText` полностью пропускает `t()`-лукап и берёт `enc.default`/`enc.variants[].text` как есть — переопределённый текст гарантированно доходит до игрока и не может быть подменён обычным переводом босса.

Для обычного спавна через `spawnBoss` поле `__scriptTouchedFields` не выставлено → `touched` пуст → работает старое поведение (полный перевод через `t()`), без изменений в поведении для не-NPC боссов.

---

## Фазы

### Что такое фаза

Фаза — набор изменений, которые применяются к боссу **необратимо** при выполнении условия `if`. После срабатывания фаза больше не проверяется.

### Поля фазы

| Поле | Тип | Описание |
|------|-----|----------|
| `phase` | number | Номер фазы (уникальный в рамках босса) |
| `phase_name` | string | Имя (отображается в лог-сообщениях; переводится) |
| `if` | expr | Условие срабатывания |
| `style` | object | Deep-merge в `boss.style` |
| `imags` | object | Deep-merge в `boss.imags` |
| `energy` | number | Заменяет `boss.maxEnergy` (энергия clamp'ится) |
| `stats` | object | Patch-мердж в `boss.stats` |
| `function` | object | Patch-мердж способностей |

### Условия `if`

Синтаксис аналогичен условиям нарратива/encounter_text, но работает **только на сервере** (`boss.js`).

```jsonc
// Прямое сравнение: [левая_часть, оператор, правая_часть]
["mob:hp", "<", ["mob:maxHp", "*", 0.5]]

// AND-массив: несколько условий одновременно
[
  ["mob:hp", "<", 30],
  ["player:hp", ">", 50]
]
```

**Операторы:** `>`, `>=`, `<`, `<=`, `=`/`==`, `!=`

**Пространства имён:**
- `mob:<field>` — поле текущего босса (напр. `mob:hp`, `mob:maxHp`, `mob:energy`)
- `player:<field>` — поле игрока (напр. `player:hp`, `player:maxHp`)

**Вычисляемые значения:**
```jsonc
["mob:maxHp", "*", 0.5]   // mob.maxHp * 0.5
["mob:maxHp", "+", 10]    // mob.maxHp + 10
```

Операторы в ссылках: `*`, `/`, `+`, `-`.

### Порядок проверки фаз

1. После каждого хода в `routes/combat.js` вызывается `checkPhases(combat, player)`.
2. Все нетриггерные фазы проверяются по `if`.
3. Сработавшие применяются через `applyPhase` и добавляются в `boss.triggeredPhases`.
4. Ответ включает `triggeredPhases` — клиент показывает сообщение о переходе фазы.

### Применение фазы (`applyPhase`)

```js
// Накапливаемые оверлеи
boss.style = { ...boss.style, ...phase.style };
boss.imags = { ...boss.imags, ...phase.imags };

// Замена энергии
boss.maxEnergy = phase.energy;
boss.energy    = Math.min(boss.energy, boss.maxEnergy);

// Патч статов → ре-применяет applyStatModes
boss.stats = { ...boss.stats, ...phase.stats };
applyStatModes(boss.stats, boss.abilities);

// Патч способностей (частичный)
Object.assign(boss.abilities[abilId], override);
```

---

## Encounter text боссов

Расширяет формат encounter_text мобов дополнительными полями:

| Поле | Тип | Описание |
|------|-----|----------|
| `priority` | number | Числовой приоритет (выше = предпочтительнее) |
| `extension` | bool | `true` → добавляется к выбранному тексту, не заменяет его |

**Алгоритм выбора:**
1. Проверяются все варианты, условия которых выполнены.
2. Из не-extension вариантов выбирается с максимальным `priority`.
3. Все `extension: true` варианты, чьи условия выполнены, добавляются в конец.
4. Если не-extension вариант не найден — берётся `default`.

---

## Добавление нового босса

1. Создать папку `assets/boss/<boss_id>/` со спрайтами.
2. Добавить запись в `assets/boss/manifesto.json`.
3. При необходимости — добавить переводы в `assets/translation/<lang>/boss/<boss_id>.json`.
4. Указать уровень появления через `level` и квоту через `count`.
5. Перезапустить сервер.

### Файл переводов босса

```json
{
  "name": "Translated Boss Name",
  "encounter_default": "Translated encounter text",
  "encounter_berserk_rage": "Translated variant text",
  "phase_1_name": "Ярость",
  "phase_1_text": "Босс перешёл в фазу ярости!"
}
```

---

## API и клиент

Клиент определяет боссов по флагу `combat.mob.isBoss === true` в `pubSession`.

Дополнительные клиентские данные боссов в `combat.mob`:
```json
{
  "isBoss": true,
  "style":  { "shadow_color": "#3E5B18", "shadow_opacity": 0.3 },
  "phases": [{ "phase": 1, "phase_name": "Rage" }],
  "triggeredPhases": []
}
```

`phases` — список фаз с именами (без условий и оверлеев — они остаются на сервере).  
`triggeredPhases` — номера уже сработавших фаз (`combat.mob.triggeredPhases`, обновляется в `pubSession`).

При срабатывании фазы (`checkPhases`, вызывается из `resolveTurn` после урона/лечения — см. [combat_system.md](combat_system.md)) `POST /api/combat/turn` не добавляет отдельное поле, а кладёт запись в общий `log`:
```json
{ "text": "Босс взревел!", "type": "phase", "phase": 1, "phase_name": "Rage" }
```
`text` — уже переведённый и подставленный (`phase_text` с заменой `{mob_name}`, либо дефолтный `combat.phase_entered`).
