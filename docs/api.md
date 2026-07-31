# API сервера

Все запросы и ответы — JSON. Сервер хранит одну активную сессию в памяти. Если перезапустить сервер без автосохранения — прогресс потеряется. Состояние автоматически сохраняется в `save/.session.json` после каждого изменения.

---

## GET `/api/settings`

Возвращает текущую конфигурацию (`save/config.json`).

**Ответ:**
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
  "sfxVolume": 0.2,
  "lang": "ru"
}
```

---

## POST `/api/settings`

Сохраняет настройки. Все поля необязательны — обновляются только переданные.

Поддерживаемые поля: `provider`, `model`, `url`, `openrouterKey`, `openrouterModel`, `ollamaJsonMode`, `openrouterJsonMode`, `bgVolume`, `battleVolume`, `sfxVolume`.

---

## GET `/api/languages`

Список доступных языков и текущий язык.

**Ответ:**
```json
{ "current": "ru", "langs": [{ "code": "ru", "name": "Русский" }, { "code": "en", "name": "English" }] }
```

---

## POST `/api/language`

Переключает язык. Ре-гидрирует текущую сессию (имена мобов/предметов обновляются на лету).

**Тело:** `{ "lang": "en" }`

---

## GET `/api/ui-strings`

Возвращает все строки UI на текущем языке (для клиентской локализации).

---

## GET `/api/media`

Полный реестр медиа из `assets/config/media.json` (звуки, музыка, видео для `event.json`).

**Ответ:**
```json
{
  "sound":  { "event_sting": { "src": "ui/sting.mp3", "volume": 0.9 } },
  "music":  { "tension": "battle/fight2.mp3" },
  "video":  { "intro": "cinematics/intro.webm" }
}
```

Клиент кеширует ответ в `event.js` (`_getMedia()`).

---

## GET `/api/ui-sounds`

Возвращает карту UI-звуков из `MEDIA.sound` (тот же реестр, что используется для `playUi`).

**Ответ:**
```json
{
  "dungeon_move":   { "src": "ui/dungeon_room.mp3", "volume": 0.8 },
  "chest_open":     "ui/default_stub.mp3",
  "item_pickup":    "ui/default_stub.mp3",
  "item_pickup_key": "ui/default_stub.mp3",
  "npc_open":       "ui/default_stub.mp3",
  ...
}
```

Форматы значений: `null` (тихо), `"path"`, `["p1","p2"]` (случайный), `{ "src": ..., "volume": N }`.

---

## GET `/api/combat-config`

Возвращает параметры визуальных анимаций боя для текущего режима (`battle_queue` из `core.json`).

**Ответ:**
```json
{ "delay_ms": 300, "first_action": "mob", "sequential": ["attack:attack"] }
```

- `sequential` — пары `"playerAction:mobAction"`, при которых анимации идут последовательно.
- `delay_ms` — задержка между анимациями в последовательном режиме.
- `first_action` — кто анимируется первым в sequential-паре (`"mob"` или `"player"`).

---

## GET `/api/manifesto`

Базовый манифест игрока (стартовые статы/ресурсы).

**Ответ:** `{ "player": {...} }` (структура — `assets/player/manifesto.json`, см. [manifests.md](manifests.md))

---

## GET `/api/skills`

Дерево навыков целиком (`assets/config/skills.json`).

---

## GET `/api/skills-config`

Общие параметры дерева навыков (стоимости, лимиты) — см. [manifests.md](manifests.md).

---

## GET `/api/skills-i18n`

Локализованные строки дерева навыков на текущем языке.

---

## GET `/api/equip-config`

Конфигурация слотов экипировки (`assets/config/core.json → mechanics.equipment`) — какие слоты какие `equip`-коды предметов принимают.

**Ответ:**
```json
{ "weapon": { "type": "weapon" }, "shield": { "type": "shield" }, "amulet": {}, "ring": {} }
```

---

## GET `/api/music-tracks`

**Ответ:**
```json
{
  "bg":     ["/assets/sound/background_music/1.mp3"],
  "battle": ["/assets/sound/battle/fight1.mp3"]
}
```

---

## GET `/api/preload-assets`

Список всех медиафайлов в `assets/` для предзагрузки. Поддерживает `.png`, `.jpg`, `.webp`, `.gif`, `.svg`, `.mp3`, `.ogg`, `.wav`.

**Ответ:** `{ "urls": ["/assets/...", ...] }`

---

## GET `/api/credits`

Список титров (`assets/db/credits.json`). При ошибке чтения — `[]`.

---

## GET `/api/credits-tracks`

Список аудиодорожек для экрана титров.

**Ответ:** `["/assets/sound/credits/1.mp3", ...]`

---

## Аккаунт (кросс-сейв статистика)

Переживает `/api/new-game` и `/api/quit` — хранится в `save/account.json`, отдельно от игровой сессии.

### GET `/api/account`

**Ответ:**
```json
{
  "gamesStarted": 3, "totalDefeats": 1, "maxFloor": 4,
  "totalKills": 20, "totalSpared": 2, "totalBossKills": 1,
  "totalNpcMet": 5, "npcsMet": ["merchant_1"],
  "achievements": ["first_blood"],
  "npcRelationships": { "one_lost": 12 },
  "npcMemory": { "one_lost": ["На 2 этаже рыцарь мог меня убить, но пощадил."] }
}
```

---

### GET `/api/achievements`

Список всех определений ачивок (`assets/config/achievements.json`, см. [manifests.md](manifests.md)).

---

### POST `/api/achievement/grant`

Выдаёт ачивку игроку (идемпотентно — повторный вызов с уже выданной ачивкой ничего не делает).

**Тело:** `{ "id": "first_blood" }`

**Ответ:**
- `{ "ok": true, "already": true }` — уже была выдана.
- `{ "ok": true, "granted": true, ...PubSession }` — выдана, есть активная сессия (за `type: "point"` начисляются `skillPoints`, за `type: "stats"` — прирост `maxHp`/`maxEnergy` сразу добавляется к текущим `hp`/`energy`).
- `{ "ok": true, "granted": true }` — выдана, активной сессии нет.

---

### POST `/api/account/reset`

Полный сброс аккаунта (статистика, ачивки, отношения и память NPC) + завершение текущей игры без сохранения.

---

## AI-проверка провайдера (`ai.js`)

Гейт перед входом в игру (обязателен, если `start_game.required_ai_system: true` в `core.json`) плюс кнопка «Проверить модель» в настройках с живым прогресс-баром и оценкой качества.

### POST `/api/ai-check`

Быстрая проверка доступности AI по текущим сохранённым настройкам (`cfg`). Результат кешируется на время жизни процесса по сигнатуре настроек провайдера (provider/model/url/ключи/режим) — повторный вызов с теми же настройками не бьёт по сети.

**Тело:** нет.

**Ответ:**
- `{ "ok": true, "required": false }` — гейт выключен в конфиге.
- `{ "ok": true, "cached": true }` — уже проверялось в этом процессе с текущими настройками.
- `{ "ok": true }` — проверка прошла успешно только что.
- `{ "ok": false, "error": "<detail>", "hint": "..." }` — провайдер недоступен.

---

### POST `/api/ai-test-step`

Один шаг теста модели за запрос — так клиент ведёт живой прогресс-бар в настройках. Значения формы (ещё не сохранённые в `cfg`) можно передать в теле — они временно подставляются поверх сохранённого конфига, на диск ничего не пишется.

**Тело:**
```json
{
  "step": "basic",
  "provider": "ollama", "model": "llama3", "url": "http://localhost:11434",
  "ollamaMode": "local", "ollamaCloudKey": "",
  "openrouterKey": "", "openrouterModel": "",
  "ollamaJsonMode": true, "openrouterJsonMode": true
}
```

`step`: `"basic"` (доступность провайдера), `"combat"` (реплика в боевом формате action/speech/notes), `"perception"` (разбор боевых чисел в структурированный JSON). Все поля кроме `step` необязательны.

**Ответ:**
```json
{ "result": { "id": "basic", "ok": true, "ms": 412, "detail": "Модель на связи и отвечает" } }
```

При провале шага: `{ "result": { "id": "combat", "ok": false, "ms": 900, "detail": "<текст ошибки>" } }`.

---

### POST `/api/ai-rate`

Оценка качества модели по завершённой серии шагов (результаты `ai-test-step`, накопленные клиентом).

**Тело:**
```json
{ "results": [
  { "id": "basic",      "ok": true, "ms": 412 },
  { "id": "combat",     "ok": true, "ms": 1500 },
  { "id": "perception", "ok": true, "ms": 800 }
] }
```

**Ответ:**
```json
{ "score": 88, "ratingKey": "excellent", "avgMs": 904 }
```

- Если все шаги `ok: true` — `score` в диапазоне `70..100`, растёт при меньшей средней задержке (пороги `speed_ms.excellent/good/fair` в `assets/config/ai_test.json`).
- Если есть провалившиеся шаги — `score = (passed/total) * 60`, `avgMs: null`.
- `ratingKey`: `"excellent" | "good" | "fair" | "poor"` (пороги `ratings[].min_score` в том же конфиге).
- Если все шаги прошли — текущие настройки формы (из тела запроса) сразу засчитываются как пройденный гейт `/api/ai-check` (кэш обновляется под эти настройки).

---

## Dev-режим (`dev.js`)

Активен только если процесс запущен с флагом `-developer` (`node server.js -developer` / упакованный `.exe -developer`). Даёт клиентской dev-панели (маленькая кнопка «DEV» в углу экрана) доступ к живому логу всех AI-вызовов (промт/ответ/тайминг) — см. `server/engine/devlog.js` в [server.md](server.md).

### GET `/api/dev/status`

**Ответ:** `{ "enabled": true|false }` — клиент рендерит кнопку панели только если `true`.

---

### GET `/api/dev/log`

**Query:** `?since=<id>` — вернуть только записи с `id` больше указанного (инкрементальный поллинг).

**Ответ:**
```json
{ "entries": [
  {
    "id": 42, "ts": 1783259537924, "ok": true,
    "provider": "ollama", "model": "gpt-oss:20b-cloud", "jsonMode": false,
    "caller": "server/engine/npc.js:230:15",
    "messages": [ { "role": "system", "content": "..." }, { "role": "user", "content": "..." } ],
    "response": "...", "ms": 812
  }
] }
```

При ошибке AI-вызова вместо `response` — поле `error`, `ok: false`.

Если сервер запущен не в dev-режиме — `404 { "error": "Dev mode is off" }`.

---

### POST `/api/dev/log/clear`

Очищает лог. **Тело:** нет. **Ответ:** `{ "ok": true }`. Тот же 404, если dev-режим выключен.

---

## POST `/api/new-game`

Создаёт новую игру с уровнем подземелья 1.

**Ответ:** [PubSession](#pubsession)

---

## GET `/api/session`

Возвращает текущую сессию (или восстанавливает из `.session.json`).

**Ответ:** `{ "has": true, ...PubSession }` или `{ "has": false }`

---

## POST `/api/quit`

Завершает текущую игру без сохранения (удаляет `.session.json`).

---

## GET `/api/saves`

Список именованных сохранений.

**Ответ:**
```json
[{ "id": "2026-05-09-11-08-34", "level": 2, "hp": 75, "xp": 120, "gold": 15 }]
```

---

## POST `/api/save`

Создаёт именованное сохранение.

**Ответ:** `{ "ok": true, "saveId": "2026-05-09-11-08-34" }`

---

## DELETE `/api/saves/:id`

Удаляет сохранение по ID.

---

## GET `/api/journal`

Журнал событий текущей сессии (`session.journal`) — лента боевых/сюжетных/диалоговых записей, добавляемых через `addJournal()`.

**Ответ:** `[]` без активной сессии, иначе массив записей журнала.

---

## POST `/api/load`

Загружает сохранение.

**Тело:** `{ "saveId": "2026-05-09-11-08-34" }`

**Ответ:** PubSession

---

## POST `/api/move`

Перемещение в соседнюю комнату.

**Тело:** `{ "direction": "right" }` (`left | right | top | bottom`)

**Ответ:** PubSession + `"combatStarted": true/false`

Если в новой комнате есть моб или босс — бой запускается немедленно, `combatStarted: true`. То же самое может произойти и с NPC: если у него `combat.aggro: "on_sight"` и текущее `relationship` не выше `aggro_relationship_below` — бой стартует автоматически при входе в комнату, без кнопки «Напасть» (подробности — [npc_combat.md](npc_combat.md)).

---

## POST `/api/interact`

Взаимодействие с объектом текущей комнаты.

**Тело:** `{ "objectId": "<instanceId>" }`

**Ответ:** PubSession + `"message"`, `"interactType"`, опционально `"levelUp"`, `"newLevel"`

| `action` объекта | `interactType` | Что происходит |
|-----------------|----------------|----------------|
| `pickup` / `items` | `"item"` | Предметы → инвентарь, объект удаляется |
| `pickup` (ключ) | `"key"` | Ключ → инвентарь + `dungeon.hasKey = true` |
| `chest` | `"chest"` | Рандомный лут по `chance`, помечается `opened: true` |
| `door` | `"door"` | Требует ключ; создаёт подземелье level+1, возвращает `levelUp: true` |

Клиент использует `interactType` для выбора UI-звука.

---

## POST `/api/narrate`

Обрабатывает текст через AI-нарратора. Использует системный промт из `path_promt_narrator` соответствующей секции `narrative.json`.

**Тело:**
```json
{ "text": "Исходный шаблонный текст", "section": "after_combat" }
```

`section`: `"after_combat"`, `"after_defeat"`, `"npc_trader"`, `"npc_other"`, `"npc_trader_combat"`, `"npc_other_combat"`. Всё остальное (или отсутствие поля) → секция `beffore_combat`.

`npc_trader_combat` / `npc_other_combat` переиспользуют те же секции конфига, что `npc_trader` / `npc_other`, но для промта сначала пробуют `path_promt_narrator_combat` (если задан в `narrative.json`), и только потом обычный `path_promt_narrator`. Используются для описания исхода NPC-боя (см. [npc_combat.md](npc_combat.md)) — обычный `after_combat`/`after_defeat` для этого не подходит, т.к. NPC-бой заканчивается иначе (`kill`/`spare`/`player_defeat`).

**Ответ:** `{ "text": "Атмосферный текст нарратора..." }`

Если `narrative: false` в конфиге — возвращает `{ "text": <исходный text> }` без AI-запроса.

---

## POST `/api/combat/narrator`

Сохраняет последний показанный игроку текст нарратора текущего боя (чтобы восстановить его в UI без повторного AI-запроса, например после reload). Без активного боя — no-op.

**Тело:** `{ "text": "..." }`

**Ответ:** `{}`

---

## POST `/api/combat/turn`

Ход в бою.

**Тело:**
```json
{
  "action": "attack",
  "message": "Сдавайся!"
}
```

Допустимые `action`: `attack`, `defend`, `wait`, `heal` (и расширенные, если разблокированы навыком: `magical_attack`, `magical_defend`, `attack_stabbing`).

**Ответ:**
```json
{
  "playerAction": "attack",
  "mobAction": "defend",
  "mobSpeech": "Ха! Не пробить!",
  "log": [
    { "text": "Игрок атакует — Скелет блокирует 15, получает 5 урона!", "type": "damage-ai" }
  ],
  "result": null,
  "reward": null,
  "triggeredPhases": [],
  ...PubSession
}
```

`result`: `null` — бой продолжается, `"victory"` — победа, `"defeat"` — поражение, `"mercy_choice"` — моб сдался, `"npc_special_defeat"` — особый мирный исход поражения от NPC-боя (см. ниже).

`triggeredPhases`: массив сработавших фаз босса в этом ходу (пустой для обычных мобов).

`reward` (при победе/помиловании):
```json
{ "xp": 25, "drops": ["5 золота", "Эликсир ×1"], "levelUp": { "newLevel": 2, "spGained": 1 } }
```

**NPC-бой (`mob.sourceNpc` задан):** ответ может содержать дополнительные поля — механика подробно описана в [npc_combat.md](npc_combat.md), здесь только форма:

| Поле | Когда | Описание |
|------|-------|----------|
| `npcOpen` | victory при `sourceNpc`, если у NPC задан `on_kill`/`on_spare`-конфиг с `event` (обычно после `mercy: spare`, см. `/api/combat/mercy`) | Клиенту стоит сразу открыть модалку NPC |
| `npcInstanceId` | вместе с `npcOpen` | ID NPC для модалки |
| `npcSpecialDefeat` | `result: "npc_special_defeat"` | `{ "outcome": "...", "text": "..." }` — вместо обычного game over игрок остаётся жив, показывается этот текст |

При `result: "npc_special_defeat"` сессия **не** обнуляется (в отличие от обычного `"defeat"`) — бой завершается, игра продолжается как обычно.

**Типы записей `log`:**

| `type` | Описание |
|--------|----------|
| `damage-player` | Урон игроку |
| `damage-ai` | Урон мобу |
| `crit-player` | Крит по игроку |
| `crit-ai` | Крит по мобу |
| `blocked` | Атака полностью заблокирована |
| `heal` | Исцеление |
| `info` | Ожидание / нейтральное событие |

---

## POST `/api/combat/flee`

Попытка побега. Доступна один раз за бой, только при HP < 30%, стоит 25 энергии, шанс 30%.

**Ответ:** `{ "fled": true/false, ...PubSession }`

---

## POST `/api/combat/mercy`

Финальный выбор судьбы сдавшегося моба (когда `pendingMercy: true`).

**Тело:** `{ "choice": "spare" }` или `{ "choice": "kill" }`

| `choice` | Результат |
|----------|-----------|
| `spare` | ½ XP, `peacefulWins++`, без дропа |
| `kill` | Полный XP + дроп, `kills++` |

**Ответ:** `{ "choice": "spare", "reward": {...}, ...PubSession }` — `reward` в том же формате, что у `/api/combat/turn` (может содержать `levelUp`).

Если моб был из NPC-боя (`mob.sourceNpc`) — ответ может дополнительно содержать `npcOpen` / `npcInstanceId` (та же логика, что у `/api/combat/turn`, см. [npc_combat.md](npc_combat.md)). Также проверяются `sourceNpc.spareable` / `sourceNpc.killable` — при запрете возвращается ошибка `npc_not_spareable` / `npc_not_killable`.

---

## POST `/api/equip`

Надеть предмет. Если слот занят — предыдущий возвращается в инвентарь.

**Тело:** `{ "itemId": "sword_iron" }`

---

## POST `/api/unequip`

Снять предмет.

**Тело:** `{ "slot": "weapon" }` (`weapon | shield | amulet | ring`)

---

## POST `/api/use-item`

Использовать предмет. В бою — один эликсир за ход (`elixirUsedThisTurn`).

**Тело:** `{ "itemId": "elixir_healing" }`

---

## POST `/api/skill/learn`

Изучить навык из дерева (списывает `skillPoints`).

**Тело:** `{ "skillId": "bt_p1" }`

**Ответ:** PubSession или `{ "error": "..." }`

---

## Сценарный диалог

Диалоги описаны в `assets/config/dialogue.json`, тексты — в `assets/translation/{lang}/dialogue.json`.  
Состояние хранится в `session.dialogue` на сервере.

### POST `/api/dialogue/start`

**Тело:** `{ "dialogueId": "intro_merchant" }`

**Ответ:**
```json
{
  "node": {
    "id": "n1",
    "text": "...",
    "speaker": "npc",
    "choices": [{ "text": "...", "index": 0 }],
    "skippable": true
  }
}
```

Нельзя вызывать во время боя.

---

### POST `/api/dialogue/advance`

**Тело:** `{ "choiceIndex": 0 }` — для ветвления; для линейного узла можно `{}` или без поля.

**Ответ (продолжение):**
```json
{ "done": false, "node": { ... } }
```

**Ответ (конец):**
```json
{ "done": true, "ends_with": "combat" }
```

`ends_with`: `"combat"` | `"shop"` | `"free_chat"` | `"close"` | `null` — подсказка клиенту (`dialogue.js`).

---

### POST `/api/dialogue/close`

Аварийное закрытие (ESC). Очищает `session.dialogue`.

**Ответ:** `{ "ok": true }`

---

## События (`event.json`)

### POST `/api/event/fire`

Запускает событие по ID. Сервер применяет `set` и цепочки; клиенту отдаёт список медиа-действий.

**Тело:** `{ "eventId": "floor2_intro" }`

**Ответ:**
```json
{
  "alreadyFired": false,
  "actions": [
    { "type": "sound", "value": "event_sting" },
    { "type": "narrator", "value": { "text": "...", "skippable": true } },
    { "type": "dialogue", "value": "intro_merchant" }
  ]
}
```

Если `once: true` и событие уже срабатывало:
```json
{ "alreadyFired": true, "actions": [] }
```

| `type` | `value` | Клиент |
|--------|---------|--------|
| `sound` | ключ из `media.json` или UI | `sfx.play` / `playUi` |
| `music` | ключ или `null` | смена/остановка трека |
| `video` | ключ | полноэкранное видео |
| `narrator` | `{ text, text_key?, skippable? }` | оверлей текста |
| `dialogue` | `dialogueId` | `startDialogueUI()` |

---

## Scavenge (обыск комнаты)

`GET /api/scavenge/scene`, `POST /api/scavenge/interact`, `POST /api/scavenge/use`, `POST /api/scavenge/open-event` — см. [scavenge.md](scavenge.md).

---

## NPC

Некоторые NPC также дерутся (`npc_combat`) и «помнят» встречи (`dream_ai`) — эндпоинты ниже покрывают это наравне с обычным чатом/торговлей; дизайн и механика — в [npc_combat.md](npc_combat.md).

### POST `/api/npc/interact`

Открыть диалог с NPC.

**Тело:** `{ "npcInstanceId": "u7xyz" }`

**Ответ:** `{ "npc": { ...pubNpc } }`

---

### POST `/api/npc/chat`

Отправить сообщение NPC.

**Тело:** `{ "npcInstanceId": "u7xyz", "message": "Что знаешь о Лабиринте?" }`

**Ответ:** `{ "reply": "...", "exhausted": false, "messageCount": 1 }`

---

### POST `/api/npc/attack`

Начать бой с NPC — кнопка «Напасть» в модалке NPC либо ветка диалога с `"ends_with": "combat"`. Требует, чтобы у NPC был включён `npc_combat`.

**Тело:** `{ "npcInstanceId": "u7xyz" }`

**Ответ:** PubSession + `"combatStarted": true`

Ошибки: `npc_not_attackable` (у NPC нет `npc_combat` или шаблон боя не собрался), `npc_already_defeated`, а также обычные `no_game` / `combat_active`.

---

### POST `/api/npc/close`

Аварийное/обычное закрытие модалки чата с NPC (крестик, клик по фону, ESC). Если у NPC задан `dream_ai` — асинхронно (fire-and-forget) запускает «сон»: переосмысление энкаунтера AI-моделью с обновлением памяти NPC и небольшой корректировкой `relationship`.

**Тело:** `{ "npcInstanceId": "u7xyz" }`

**Ответ:** `{ "ok": true }` — всегда и немедленно; клиент не ждёт результата `dream_ai`.

---

### POST `/api/npc/trade/buy`

Купить предмет у торговца.

**Тело:** `{ "npcInstanceId": "u7xyz", "itemId": "elixir_healing" }`

**Ответ:** `{ "ok": true, "npc": {...}, ...PubSession }`

---

### POST `/api/npc/trade/sell`

Продать предмет торговцу.

**Тело:** `{ "npcInstanceId": "u7xyz", "itemId": "sword_wood" }`

**Ответ:** `{ "ok": true, "goldGained": 3, "npc": {...}, ...PubSession }`

---

## PubSession

Структура, которую возвращают большинство эндпоинтов:

```json
{
  "player": {
    "level": 2,
    "xp": 120,
    "gold": 15,
    "charLevel": 2,
    "skillPoints": 1,
    "hp": 75,
    "maxHp": 100,
    "energy": 80,
    "maxEnergy": 100,
    "healCd": 0,
    "critChance": 0.05,
    "critMultiplier": 0.3,
    "stats": { "armor": 0, "avoidance": 0, "power": 0, "physique": 0, "agility": 0, "intelligence": 0 },
    "bonuses": { "ability:attack:int": 12 },
    "levelBonuses": { "stats:power:int": 1 },
    "learnedSkills": ["bt_p1"],
    "kills": 3,
    "peacefulWins": 1,
    "mobsEncountered": 5,
    "inventory": [{ "id": "elixir_healing", "count": 1, "name": "...", "image": "...", "equip": false, "use": {...}, "stats": null, "inventoryBar": true }],
    "equip": {
      "weapon": { "id": "sword_iron", "name": "Железный меч", "image": "...", "stats": { "ability:attack:int": 12 } },
      "shield": null,
      "amulet": null,
      "ring": null
    }
  },

  "abilities": {
    "attack": { "id": "attack", "int": 20, "chance_critical": 0.05, "multiplier_critical": 0.3, "energy_cost": 20, "sound": {...}, "sound_volume": 0.7 },
    "defend": { ... },
    "wait":   { ... },
    "heal":   { ... }
  },

  "player_actions": {
    "flee": { "action": "flee", "energy_cost": 25, "chance": 0.3, "condition": { "hp_ratio_below": 0.3 } }
  },

  "playerImagsSpec": {
    "default":  "player/Player_animated.webp",
    "attack":   "player/Player_attack.png",
    "defend":   "player/Player_defend.png",
    "dead":     "player/Player_dead.png",
    "effects":  { "heal": "player/effects/heal.png", "crit": "player/effects/crit.png" }
  },

  "playerSoundSpec":       null,
  "playerSoundVolume":     null,
  "coreSoundDefault":      "ui/soft_RPG_interface.mp3",
  "coreSoundDefaultVolume": 0.8,
  "coreSoundDefaultMob":   { "dead": null, "damage_received": { "hit": null, "crit": null } },

  "dungeon": {
    "level": 2,
    "playerPos": "1,0",
    "hasKey": false,
    "rooms": [ ...pubRoom[] ]
  },
  "currentRoom": { ...pubRoom },
  "combat": null
}
```

**Структура `pubRoom`:**
```json
{
  "gid": "1,0", "x": 1, "y": 0,
  "type": "normal",
  "image": "/assets/map/block_[l].png",
  "preview": "preview/default.png",
  "passages": { "left": true, "right": false, "top": false, "bottom": false },
  "discovered": true,
  "objects": [{ "instanceId": "u3abc", "defId": "chest_1", "name": "Сундук", "image": "...", "action": "chest", "opened": false, "locked": null }],
  "hasMob": true, "hasBoss": false,
  "mobName": "Скелет", "mobImage": "/assets/mob/skeleton/skeleton.png", "mobPawn": "...",
  "hasNpc": false, "npcName": null, "npcPawn": null, "npcImage": null, "npcType": null, "npcInstanceId": null
}
```

Для неоткрытых комнат (`discovered: false`) — только `gid`, `x`, `y`, `type`, `image`, `passages`, `discovered`.

**Структура `combat` (если бой активен):**
```json
{
  "turn": 3,
  "mob": {
    "name": "Скелет-Голем",
    "image": "/assets/boss/skeleton_golem/skeleton_golem.webp",
    "imags": { "default": "...", "attack": "...", "dead": "...", "effects": {} },
    "hp": 80, "maxHp": 100,
    "energy": 50, "maxEnergy": 100,
    "abilities": {
      "attack": { "int": 25, "enabled": true, "crit_chance": 0.4, "crit_multiplier": 0.15, "sound": {...} },
      "wait":   { "int": 25, "enabled": true }
    },
    "healCooldown": 0,
    "xp": 120,
    "sound": null,
    "soundVolume": null,
    "isBoss": true,
    "style": { "shadow_color": "#3E5B18", "shadow_opacity": 0.3 },
    "phases": [{ "phase": 1, "phase_name": "Rage" }],
    "triggeredPhases": []
  },
  "elixirUsedThisTurn": false,
  "fleeAttempted": false,
  "pendingMercy": false
}
```
