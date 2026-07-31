# Звуковая система

Игра имеет три независимых аудио-потока с отдельными ползунками громкости:

| Поток | Ползунок | Модуль |
|-------|----------|--------|
| Фоновая музыка | `bgVolume` | `music.js` → `MusicManager` |
| Боевая музыка | `battleVolume` | `music.js` → `MusicManager` |
| Звуковые эффекты | `sfxVolume` | `sfx.js` → `SfxManager` |

---

## Модель громкости SFX

```
finalVolume = userSfxVol × soundVolume
```

- **`userSfxVol`** — ползунок из настроек (0–1), хранится в `sfx._vol`
- **`soundVolume`** — мультипликатор на уровне звука (0–2+):
  - Задаётся из `core.mechanics.default_sound_volume` (мастер-множитель)
  - Переопределяется полем `sound_volume` в ability (`core.json`)
  - Переопределяется полем `sound_volume` в entity-манифесте (моб, игрок)
  - Для UI-звуков: поле `volume` в записи `media.json` → `sound`
  - Для HTML-кнопок: атрибут `data-sound-volume`

**Приоритет soundVolume:**
```
entitySoundVolume → abilityDef.sound_volume → core.default_sound_volume
```

При `default_sound_volume: 0.8` и ползунке пользователя на 100% — максимальная громкость SFX = 80%.

---

## Источники звука

### 1. Звуки способностей (бой)

Воспроизводятся через `sfx.playAbility(...)`.

**Приоритет источника:**
1. Entity-карта (`player.json.sound` / `mob.manifesto.sound`) — ключ = id способности
2. `core.json ability[id].sound` — встроенный звук способности
3. `core.json default_sound` — глобальный fallback

**Форматы entity-карты:**
```jsonc
"attack": "path.mp3"                              // всегда
"attack": ["p1.mp3","p2.mp3"]                     // случайный
"attack": { "hit": "p.mp3", "crit": "c.mp3" }    // hit/crit раздельно
```

**Формат `core.json ability.sound`:**
- `action: "attack"` → `{ "hit": ..., "crit": ... }` (массивы поддерживаются)
- `action: "damage_reduction"` → `{ "<опponentAbilityId>": path, "default": path }`
- Остальные → строка или массив

### 2. Звуки получения урона (damage_received)

Воспроизводятся через `sfx.playDamageReceived(...)`.

Срабатывают когда **игрок атакует моба** и моб **не использовал** `damage_reduction`.

**Приоритет:**
1. `mob.manifesto[id].sound.damage_received` — у конкретного моба
2. `core.json default_sound_mob.damage_received` — глобальный fallback

**Формат:**
```jsonc
"damage_received": "path.mp3"
"damage_received": ["p1.mp3","p2.mp3"]
"damage_received": { "hit": "path.mp3", "crit": "crit.mp3" }
```

### 3. UI-звуки (события интерфейса)

Воспроизводятся через `sfx.playUi(key)`.

Конфигурируются в `assets/config/media.json` → `sound`:

```jsonc
{
  "dungeon_move":      { "src": "ui/dungeon_room.mp3", "volume": 0.8 },
  "chest_open":        "ui/default_stub.mp3",
  "item_pickup":       "ui/default_stub.mp3",
  "item_pickup_key":   "ui/default_stub.mp3",
  "dungeon_stairs":    "ui/default_stub.mp3",
  "door_unlock":       "ui/default_stub.mp3",
  "item_equip":        "ui/default_stub.mp3",
  "item_unequip":      "ui/default_stub.mp3",
  "item_use":          "ui/default_stub.mp3",
  "item_buy":          "ui/default_stub.mp3",
  "item_sell":         "ui/default_stub.mp3",
  "skill_hover":       "ui/default_stub.mp3",
  "skill_learn":       "ui/default_stub.mp3",
  "npc_open":          "ui/default_stub.mp3",
  "level_up":          "ui/default_stub.mp3",
  "save_game":         "ui/default_stub.mp3",
  "combat_flee_success": "ui/default_stub.mp3",
  "combat_flee_fail":    "ui/default_stub.mp3"
}
```

**Где и когда вызывается:**

| Ключ | Вызов |
|------|-------|
| `dungeon_move` | `dungeon.js → moveTo()` после успешного перемещения |
| `dungeon_stairs` | `dungeon.js → interactWith()` при входе в дверь |
| `chest_open` | `dungeon.js → interactWith()` при открытии сундука |
| `item_pickup` | `dungeon.js → interactWith()` при подборе предмета |
| `item_pickup_key` | `dungeon.js → interactWith()` при подборе ключа |
| `level_up` | `dungeon.js → interactWith()` при переходе на следующий этаж |
| `item_equip` | `inventory.js → equipItem()` |
| `item_unequip` | `inventory.js → unequipItem()` |
| `item_use` | `inventory.js → useItem()` |
| `item_buy` | `npc.js → buyFromNpc()` |
| `item_sell` | `npc.js → sellToNpc()` |
| `npc_open` | `npc.js → openNpc()` |
| `skill_hover` | `skills.js`, pointerenter на узле навыка |
| `skill_learn` | `skills.js → learnSkill()` |
| `save_game` | `saves.js → saveGame()` |
| `combat_flee_success` | `combat.js → doFlee()` при успешном побеге |
| `combat_flee_fail` | `combat.js → doFlee()` при неудачном побеге |

### 4. HTML-кнопки с атрибутами

```html
<!-- Звук при наведении -->
<button data-sound-hover="ui/hover.mp3">...</button>

<!-- Звук при клике -->
<button data-sound-click="ui/click.mp3">...</button>

<!-- С индивидуальным мультипликатором громкости -->
<button data-sound-hover="ui/hover.mp3" data-sound-volume="0.6">...</button>
```

`sfx.initUI()` вызывается один раз при старте и вешает обработчики. Повторные вызовы идемпотентны (проверяет `_sfxHoverBound` / `_sfxClickBound`).

---

## Пути к файлам

Пути задаются **без** ведущего `/`:
- `"ui/sword/1.mp3"` → `/assets/sound/ui/sword/1.mp3`
- `"mob/skeleton/hit.mp3"` → `/assets/sound/mob/skeleton/hit.mp3`

Исключение: пути начинающиеся с `/` или `http` используются как есть.

**Рекомендуемая структура `assets/sound/`:**
```
assets/sound/
  background_music/   — треки фоновой музыки
  battle/             — треки боевой музыки
  ui/                 — UI-звуки и способности
    sword/            — звуки физических атак
      critical/
    magic/            — звуки магических атак
    dungeon_room.mp3  — переход по карте
    default_stub.mp3  — заглушка
    soft_RPG_interface.mp3
    confirm.mp3
```

---

## Настройка громкости

### Через `core.json`

```jsonc
"default_sound":        "ui/soft_RPG_interface.mp3",  // Fallback для способностей
"default_sound_volume": 0.8,                           // Мастер-множитель (0–2)
"default_sound_mob": {
  "dead": null,
  "damage_received": { "hit": null, "crit": null }     // null = тихо
}
```

### Через манифест (per-entity)

```jsonc
// mob/manifesto.json или player.json
"sound_volume": 0.9    // Переопределяет default_sound_volume для этого существа
```

### Через core ability (per-ability)

```jsonc
// core.json ability[id]
"sound_volume": 0.7    // Переопределяет default_sound_volume для этой способности
```

### Через media.json (per-event)

```jsonc
{ "src": "ui/dungeon_room.mp3", "volume": 0.8 }
```

### Через HTML (per-element)

```html
<button data-sound-hover="ui/hover.mp3" data-sound-volume="0.6">...</button>
```

---

## Добавление нового UI-звука

1. Положить файл в `assets/sound/ui/`.
2. Добавить ключ в `assets/config/media.json` → секция `sound`.
3. Вызвать `sfx.playUi('new_key')` в нужном JS-модуле.
4. Перезапуск сервера **не нужен** — карта подгружается клиентом при старте (`/api/ui-sounds`).

## Добавление звука к способности

1. Добавить поле `sound` в нужную запись `core.json ability`:
   ```json
   "sound": { "hit": "ui/my_ability.mp3", "crit": "ui/my_crit.mp3" }
   ```
2. Перезапустить сервер (core.json читается при старте).

## Добавление damage_received звука для моба

1. Добавить поле `sound` в `mob/manifesto.json`:
   ```json
   "sound": {
     "damage_received": { "hit": "mob/myMob/hit.mp3", "crit": "mob/myMob/crit.mp3" }
   }
   ```
2. Перезапустить сервер.
