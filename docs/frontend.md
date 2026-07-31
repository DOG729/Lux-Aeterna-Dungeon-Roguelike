# Клиентские скрипты

Весь клиентский код — `public/js/` (vanilla JS ES2022, ES-модули). Никаких фреймворков. Точка входа — `<script type="module" src="/js/main.js">` в `index.html`.

---

## Архитектура

```
public/js/
│
├── main.js          — инициализация, глобальные обработчики (showScreen — в dom.js)
├── state.js         — глобальное состояние: G, busy
├── api.js           — обёртка fetch() / Electron IPC для всех API-запросов
├── dom.js           — хелпер $(), screens, showScreen(), toast()
├── ai_check.js      — ensureAiReady: гейт доступности AI перед входом в игру
│
├── combat.js        — бой: анимации, doTurn, handleCombatEnd
├── dungeon.js       — подземелье: renderDungeon, renderDungeonMap, moveTo
├── inventory.js     — инвентарь: renderInventoryModal, equip/unequip/use
├── npc.js           — NPC-диалог, торговля, атака NPC
├── skills.js        — дерево навыков: рендер, пан/зум, покупка
├── saves.js         — список сохранений, загрузка, удаление
├── settings.js      — настройки: модал, провайдер AI + тест модели, языки, громкость, аккаунт
├── journal.js       — журнал событий
├── map.js           — рендер мини-карты
├── music.js         — MusicManager (фон и боевая музыка)
├── sfx.js           — SfxManager (звуковые эффекты: бой, UI, ховер)
├── i18n.js          — локализация: загрузка и применение ui-strings
├── conditions.js    — resolveTextVariant: клиентская проверка условий нарратива
├── dialogue.js      — сценарный диалог: модал, start/advance API
├── event.js         — fireEvent: последовательное выполнение actions с сервера
├── scavenge.js      — интерактивный обыск комнаты
├── gameover.js      — хук playDefeatExitAnimation (заготовка под анимацию выхода)
├── credits.js       — титры: скролл-анимация, музыка титров
├── preloader.js     — предзагрузка ассетов (прогресс-бар)
├── devpanel.js      — dev-панель (кнопка + лог AI-вызовов), рендерится только если сервер запущен в -developer
│
└── animations/      — визуальные эффекты вне основного игрового цикла
    ├── animations-entry.js               — точка входа, подключает частицы экрана меню
    └── particles/
        ├── falling-particles-engine.js   — createFallingParticles: генератор падающих спрайтов
        ├── screen-menu-falling.js        — initMenuFallingParticles: вкл/выкл по .active экрана меню
        └── particle-urls-by-scene.js     — резолв манифеста частиц (assets/image/animated/particles/manifest.json)
```

---

## state.js — Глобальное состояние

```js
export const state = {
  G:    null,   // Последний ответ сервера (PubSession)
  busy: false,  // Блокировка кнопок во время запроса
  UI:   {}      // Кеш UI-строк (i18n)
};
```

`state.G` полностью перезаписывается после большинства API-вызовов. Данные для рендера всегда берутся из `state.G`.

---

## api.js — Обёртка fetch / Electron IPC

```js
export async function api(method, url, body?) → data
```

В браузере — `fetch(url, { method, headers, body: JSON.stringify(body) })`, результат `res.json()`.  
Под Electron (`window.electronAPI` присутствует) — вызов проксируется в `window.electronAPI.invoke(url, method, body)`, минуя HTTP.  
Ошибок не выбрасывает — не проверяет `response.ok`; вызывающий код сам проверяет `data.error` в ответе.

---

## dom.js

```js
export function $(id)  { return document.getElementById(id); }
export const screens    = { menu, dungeon, combat };  // элементы .screen по id
export function showScreen(name)                       // menu | dungeon | combat
export function toast(msg)                              // всплывающее уведомление снизу
```

`showScreen(name)` — снимает `.active` со всех экранов, ставит на нужный; на экране `menu` переключает видимость `#btn-continue` по `state.G`; вызывает `applyConditions(screens[name])` для if/if-else/else директив внутри экрана.

`toast(msg)` — показывает `#toast` на ~2.6 сек (переигрывает CSS-анимацию через reflow).

---

## main.js — Инициализация

`showScreen` теперь живёт в `dom.js` (см. выше) — main.js только вешает обработчики и вызывает её.

- При загрузке: `GET /api/session` — если сессия есть, показывает `#btn-continue` и кеширует `state.G`.
- Загружает настройки, инициализирует музыку, sfx, i18n, preloader.
- Первый клик пользователя → `music.unlock()` (обход Chrome autoplay).
- `window.electronAPI` присутствует → показывает `#btn-quit-game`, вызывающую `electronAPI.quit()`.

### Вход в игру гейтится проверкой AI

`btn-continue`, `btn-new-game`, `btn-go-new` (новая игра с экрана поражения) и `loadSave()` (в `saves.js`) первым делом вызывают `await ensureAiReady()` из `ai_check.js` — если проверка не прошла, вход в игру прерывается (оверлей/тост уже показаны внутри `ensureAiReady`).

```js
$('btn-continue').addEventListener('click', async () => {
  if (!await ensureAiReady()) return;
  ...
});
```

### ESC — обработка модалок

Обработчик `keydown` собирает список открытых модалок (`modal-npc`, `modal-skills`, `modal-inventory`, `modal-journal`, `modal-settings`, `modal-saves`) и закрывает верхнюю. Модал NPC — особый случай: вместо простого `.hidden` вызывается `closeNpcModal()` из `npc.js` (чтобы уйти fire-and-forget запрос `/api/npc/close`):

```js
if (open === 'modal-npc') { closeNpcModal(); return; }
if (open) { $(open).classList.add('hidden'); return; }
```

### Экран поражения → выход

`btn-go-load` и `btn-go-new` перед переходом (загрузка сохранения / новая игра) `await`-ят `playDefeatExitAnimation()` из `gameover.js` — см. ниже.

### Инициализация SFX в main.js

```js
// В IIFE при старте:
sfx.loadUiSounds(await api('GET', '/api/ui-sounds'));   // media.json → sound
const cfg = await api('GET', '/api/settings');
sfx.setVolume(cfg.sfxVolume ?? 0.2);                   // ползунок пользователя

// При восстановлении сессии / новой игре:
if (data.coreSoundDefault       != null) sfx.setDefault(data.coreSoundDefault);
if (data.coreSoundDefaultVolume != null) sfx.setDefaultVolume(data.coreSoundDefaultVolume);
if (data.coreSoundDefaultMob    != null) sfx.setDefaultMobSounds(data.coreSoundDefaultMob);
```

---

## ai_check.js — Гейт доступности AI

```js
export async function ensureAiReady() → Promise<boolean>
```

Вызывается перед входом в игру (Continue / New Game / Load, см. `main.js` и `saves.js`). Логика:

1. `POST /api/ai-check`. Сервер кеширует успешную проверку на время жизни процесса (по сигнатуре текущих настроек AI-провайдера), поэтому повторные входы в течение сессии не бьют AI заново.
2. Оверлей `#ai-check-overlay` показывается только если ответ не пришёл за 120мс (`setTimeout`) — не мигает, когда сервер отвечает из кеша мгновенно.
3. `r.ok === true` → возвращает `true`, игра открывается.
4. Иначе (или ошибка сети) → `toast(...)` с текстом `r.hint` или фолбэком `ai_check_fail`, открывает настройки (`openSettings()`), переключает на вкладку `provider` (`setSettingsTab('provider')`), возвращает `false` — вызывающий код не входит в игру.

---

## devpanel.js — Dev-панель (лог AI-вызовов)

```js
export async function initDevPanel()
```

Вызывается один раз из `main.js` при старте. Делает `GET /api/dev/status` — если `enabled: false` (сервер не запущен с `-developer`), ничего не рендерит и выходит. Если `enabled: true`:

- Строит маленькую кнопку «DEV» с бейджиком (кол-во записей) в правом нижнем углу и выезжающую снизу панель (~45vh, тёмная тема, `public/css/devpanel.css`).
- Поллит `GET /api/dev/log?since=<lastId>` каждые 2 секунды, дописывает новые записи.
- Каждая запись — время, `ms`, `provider/model`, флаг `JSON`, `caller` (откуда вызван `aiChat`), разворачивается по клику: полный `SYSTEM`/`USER` промт и `RESPONSE`/`ERROR`.
- Кнопка «Очистить» — `POST /api/dev/log/clear`.

Ничего общего с игровой логикой не имеет — существует только для отладки промтов/ответов AI во время разработки, см. [server.md](server.md#serverenginedevlogjs--dev-режим-и-лог-ai-вызовов).

---

## sfx.js — SfxManager

Менеджер звуковых эффектов. Отдельный от MusicManager — громкость SFX регулируется независимо.

```js
export const sfx = new SfxManager();
```

### Модель громкости

```
finalVolume = userSfxVol × soundVolume
```

- `userSfxVol` — ползунок настроек (0–1), `sfx.setVolume(v)`
- `soundVolume` — мультипликатор звука (0–2+):
  - Для `playAbility`: `entitySoundVolume → abilityDef.sound_volume → _defaultVol`
  - `_defaultVol` задаётся из `core.mechanics.default_sound_volume`

### Методы

| Метод | Описание |
|-------|----------|
| `setVolume(v)` | Устанавливает ползунок пользователя (0–1) |
| `setDefault(src)` | Глобальный fallback-звук (из `core.default_sound`) |
| `setDefaultVolume(vol)` | Мастер-мультипликатор громкости (из `core.default_sound_volume`) |
| `setDefaultMobSounds(spec)` | Глобальные звуки мобов (из `core.default_sound_mob`) |
| `loadUiSounds(map)` | Загружает карту UI-звуков (`media.json` → `sound`) |
| `play(src, soundVolume?)` | Воспроизводит файл по пути |
| `playAbility(...)` | Звук способности с полным приоритетным разрешением |
| `playDamageReceived(...)` | Звук получения урона мобом |
| `playUi(key)` | Воспроизводит именованный UI-звук по ключу из `sound` |
| `initUI(root?)` | Вешает обработчики на `data-sound-hover` / `data-sound-click` элементы |

### `play(src, soundVolume?)`

Пути: начинаются с `/` или `http` → используются как есть; иначе резолвятся в `/assets/sound/<src>`.

### `playAbility(entitySoundMap, abilityId, isCrit, abilityDef, opponentAction, entitySoundVolume?)`

**Приоритет источника звука:**
1. `entitySoundMap[abilityId]` — звук из `player.json` / манифеста моба
2. `abilityDef.sound` — звук из `core.json`
3. `sfx._defaultSrc` — глобальный fallback (`core.default_sound`)

**Форматы записи в entity-карте:**
```js
"attack": "path.mp3"                           // всегда
"attack": ["p1.mp3","p2.mp3"]                  // случайный из списка
"attack": { "hit": "p.mp3", "crit": "c.mp3" } // hit / crit вариант
```

**Формат `core.json ability.sound` по типу action:**
- `action === "attack"` → `{ hit, crit }` (значения могут быть массивами)
- `action === "damage_reduction"` → `{ <opponentAbilityId>: path, "default": path }`
- Прочие (`add_*`) → строка или массив

### `playDamageReceived(mobSoundMap, isCrit, soundVolume?)`

Воспроизводится, когда игрок атакует моба и моб **не** использует `damage_reduction`.

**Приоритет:**
1. `mobSoundMap.damage_received` — поле `sound.damage_received` из манифеста моба
2. `core.default_sound_mob.damage_received` — глобальный fallback

**Формат `damage_received`:**
```jsonc
"damage_received": "path.mp3"
"damage_received": ["p1.mp3","p2.mp3"]
"damage_received": { "hit": "path.mp3", "crit": "crit.mp3" }
```

### `playUi(key)`

Воспроизводит звук по ключу из `media.json` → `sound`. Форматы значений:
```jsonc
null                              // тихо
"ui/path.mp3"                     // фиксированный файл
["p1.mp3","p2.mp3"]              // случайный выбор
{ "src": "path.mp3", "volume": 0.8 } // с мультипликатором громкости
```

### `initUI(root?)` — звуки HTML-элементов

Вешает обработчики на элементы с `data-sound-hover` или `data-sound-click`.  
Атрибут `data-sound-volume="0.8"` задаёт мультипликатор для конкретного элемента:

```html
<button data-sound-hover="ui/hover.mp3" data-sound-volume="0.8">...</button>
<button data-sound-click="ui/click.mp3">...</button>
```

---

## combat.js — Бой

### `animateCombat(playerAction, mobAction, log, mobImags) → Promise<number>`

Запускает визуальные анимации боя. Возвращает общую длительность в мс (используется для синхронизации последующих событий).

При первом вызове за сессию загружает конфигурацию анимации с `/api/combat-config` (кешируется в `_combatCfg`).

**Логика:**
1. Проверяет, является ли пара `"playerAction:mobAction"` sequential (из `_combatCfg.sequential`).
2. **Sequential:** анимации идут одна за другой с задержкой `delay_ms`. Кто первый — определяется `first_action` (`"mob"` или `"player"`). Возвращает `delay_ms + SPRITE_MS`.
3. **Simultaneous:** обе анимации запускаются одновременно. Возвращает `SPRITE_MS`.

`mobImags` передаётся явно, потому что к моменту вызова `state.G.combat` может быть `null` (моб убит).

### `_animatePlayer(playerAction, log)`

- `attack` → CSS-класс `anim-attack` на игрока, `anim-hit` на моба, спрайт атаки, эффект-оверлей атаки на мобе.
- `defend` → спрайт защиты, эффект на игроке.
- `heal` → спрайт и эффект heal на игроке.
- `wait` → только лог.

Звук: `sfx.playAbility(state.G?.playerSoundSpec, action, isCrit, abilityDef, mobAction, state.G?.playerSoundVolume)`.

### `_animateMob(mobAction, log, mobImags)`

Зеркально: `attack` → рывок `anim-mob-attack`, `anim-hit` на игрока, эффект атаки на игроке.

Дополнительно: если действие игрока — `attack` и действие моба **не** `damage_reduction` → воспроизводится звук получения урона мобом:
```js
sfx.playDamageReceived(mob.sound, playerHitCrit, mob.soundVolume);
```

### `doTurn(action)`

```
1. busy = true → updateCombatButtons() блокирует кнопки
2. Читаем и очищаем текстовое поле сообщения
3. Показываем "⏳ Моб думает…"
4. POST /api/combat/turn
5. Удаляем индикатор ожидания
6. Сохраняем prevMobImags (нужен для dead-анимации, т.к. G.combat = null после победы)
7. G = data (новое состояние)
8. Добавляем в чат: разделитель хода, действия, лог, речь моба
9. animDuration = await animateCombat(...)
10. Если бой продолжается: renderCombat() + busy = false
11. Если бой закончен (result !== null):
    - HP-бары вручную обнуляются (G.combat = null, поэтому renderCombat() не поможет)
    - playDeadSprite с задержкой animDuration + 100мс
    - setTimeout(animDuration + ~780мс): handleCombatEnd() + busy = false
```

### `_showNarration()`

Асинхронная. Вызывается в конце `enterCombat()`. Обычно читает `narrative.beffore_combat` и `mob.encounter_text` из `state.G`. При `is_ai: true` блокирует кнопки боя (`state.busy = true`) до ответа AI, показывает плейсхолдер `«…»`.

**Бой с NPC** (`mob.sourceNpc` заполнено сервером, когда моб — это атакованный NPC, см. [npc_combat.md](npc_combat.md)): вместо общего "before_combat" нарратора используется персональная секция —
`narrative.NPC.trader` / `narrative.NPC.other` (по `sourceNpc.npcType`) вместо `narrative.beffore_combat`, и при отправке на `/api/narrate` передаётся `section: 'npc_trader_combat' | 'npc_other_combat'` вместо `undefined`. Идея — у знакомого NPC другой тон нарратива (личное напряжение, а не монстр-хоррор).

### `_showAfterCombatNarration(mob, sectionKey = 'after_combat')`

Асинхронная. Вызывается из `handleCombatEnd`: с `sectionKey = 'after_combat'` при победе, с `'after_defeat'` при поражении. Записывает нарративный текст в `#go-sub` в модале game-over. При `is_ai: true` сначала показывает `«…»`, затем ответ AI. При сдаче (`mercy_choice`) **не вызывается**.

### `handleCombatEnd(result, reward, prevMob?)`

- `music.exitBattle()` — возврат к фоновой музыке.
- Устанавливает иконку победы/поражения.
- Показывает `#modal-gameover`.
- При `result === "victory" | "kill"` вызывает `_showAfterCombatNarration(prevMob, 'after_combat')`.
- При поражении вызывает `_showAfterCombatNarration(prevMob, 'after_defeat')`.

`prevMob` — экземпляр моба, захваченный до `G = data` в `doTurn`, так как после победы/поражения `state.G.combat === null`.

### `npc_special_defeat` — небоевой исход NPC-схватки

`doTurn()` проверяет `data.result === 'npc_special_defeat'` отдельно от обычного `'defeat'` (описано в [npc_combat.md](npc_combat.md) §5 — особый ненасильственный исход боя с NPC). В этом случае **не** вызывается `handleCombatEnd` / модал game-over:

```js
if (data.result === 'npc_special_defeat') {
  document.body.classList.remove('boss-fight');
  music.exitBattle();
  showScreen('dungeon');
  window.renderDungeon();
  toast(data.npcSpecialDefeat?.text ?? '');
}
```

Игрок остаётся в подземелье; проигрывается "мёртвый" спрайт игрока (как при обычном поражении), но бой продолжается как обычное приключение — только тост с текстом вместо экрана game-over.

### `playSprite(imgEl, imags, action, totalMs = 680)`

Воспроизводит анимацию действия. `imags[action]` — строка (1 кадр) или массив. Кадры чередуются, в конце восстанавливается `imags.default`.

### `showEffect(effectEl, src, durationMs = 750)`

Показывает эффект-оверлей (`<img class="sprite-effect">`). Добавляет класс `.fx-on` (opacity 1), убирает через `durationMs`.

### `playDeadSprite(imgEl, imags, delayMs, durationMs = 700)`

Анимация смерти после задержки `delayMs`. Ставит `imags.dead`.

### `_clearFx()` / `_fxTimers`

Все `setTimeout` анимаций регистрируются в `_fxTimers`. `_clearFx()` отменяет их при новом ходу.

---

## dungeon.js — Подземелье

### `renderDungeon()`

Основной рендер экрана подземелья: статы игрока, инвентарь быстрого доступа, информация о комнате.

`renderDungeonMap()` (тайловая карта) фактически реализована в `map.js` и импортируется сюда — см. секцию [map.js](#mapjs--мини-карта) ниже.

### `moveTo(direction)`

`POST /api/move`. Если `combatStarted: true` — переключает на экран боя.  
Звук: `sfx.playUi('dungeon_move')` после успешного перемещения.

### `interactWith(objectId)`

`POST /api/interact`. Воспроизводит UI-звук на основе поля `interactType` из ответа:

| `interactType` | Звук |
|----------------|------|
| `'chest'` | `sfx.playUi('chest_open')` |
| `'key'` | `sfx.playUi('item_pickup_key')` |
| `'item'` | `sfx.playUi('item_pickup')` |
| `'door'` | `sfx.playUi('dungeon_stairs')` |

При `data.levelUp: true` → `sfx.playUi('level_up')` + показывает модал `#modal-levelup`.

Если у комнаты `scavenge.autoOpen` и `visited === false` — `renderDungeon()` вызывает `openScavenge()` (см. [scavenge.md](scavenge.md)).

### Кнопка «Осмотреться» (`renderRoomActions`)

Если у комнаты есть `room.scavenge` и (`!visited || repeatOpen`) — в панели `#room-actions` рисуется пункт с иконкой глаза (`views_close.png`) и кнопкой `.ra-btn-scavenge` с текстом `scavenge.look_name` («Осмотреться»). Клик вызывает `openScavenge(undefined, undefined, { zoom: true })` — сервер сам подгрузит сцену, `{ zoom: true }` включает кинематографичный zoom-in (см. `scavenge.js`).

---

## dialogue.js — Сценарный диалог

Модал `#modal-dialogue`, создаётся лениво при первом вызове.

### `startDialogueUI(dialogueId) → Promise<ends_with | null>`

1. `POST /api/dialogue/start` → рендер первого узла.
2. По клику / выбору → `POST /api/dialogue/advance`.
3. При `{ done: true }` закрывает модал и резолвит Promise значением `ends_with`.

Вызывается из `event.js` при action `{ type: 'dialogue', value: '...' }`.  
Клиент может обработать `ends_with === 'combat'` (переход в бой) и т.д.

`POST /api/dialogue/close` — при ESC.

---

## event.js — События

### `fireEvent(eventId)`

```
POST /api/event/fire → actions[]
for each action: await _exec*(...)
```

| Тип | Поведение |
|-----|-----------|
| `sound` | `MEDIA.sound[key]` или fallback `sfx.playUi(key)` |
| `music` | override трека; `null` — сброс |
| `video` | полноэкранный `<video>` |
| `narrator` | текстовый оверлей (с `text_key` через i18n) |
| `dialogue` | `startDialogueUI(value)` |

`preloadMedia()` — предзагрузка видео из `/api/media` (вызывается из `main.js`).

---

## scavenge.js — Обыск

Кратко: `openScavenge` / `closeScavenge`, модал `#modal-scavenge`, auto-open из `dungeon.js`.  
Подробно — [scavenge.md](scavenge.md).

### Zoom-переход «Осмотреться»

`openScavenge(sceneData, roomState, opts)` — новый третий параметр `opts.zoom`. Когда `true` (ручной клик по кнопке «Осмотреться», см. `dungeon.js`; при тихом auto-open параметр не передаётся), перед открытием модала проигрывается кинематографичный push-in зум на `#dng-map-wrap`:

```js
const tile = document.querySelector('#dng-map .map-tile.current');
wrap.style.transformOrigin = `${tileX}px ${tileY}px`;   // центр текущего тайла игрока
wrap.classList.add('zoom-into-scavenge');
await new Promise(r => setTimeout(r, 320));
wrap.classList.remove('zoom-into-scavenge');
```

Точка зума — центр тайла игрока (`.map-tile.current`) на карте подземелья, а не центр экрана (`getBoundingClientRect` тайла и обёртки). Если тайл не найден — `transformOrigin` сбрасывается. После пуш-ина модал ещё и получает класс `zoom-enter` (CSS-анимация появления), снимаемый по `animationend`.

---

## inventory.js — Инвентарь

**Слоты экипировки** (`#inv-slots`): `weapon`, `shield`, `amulet`, `ring`. Если слот заполнен — иконка, название, статы, кнопка «Снять» (заблокирована в бою).

**Сумка** (`#inv-items`): все предметы из `player.inventory`.
- Надеваемые → кнопка «Надеть» (заблокирована в бою) → `sfx.playUi('item_equip')`
- Используемые → кнопка «Выпить»/«Использовать» → `sfx.playUi('item_use')`
- Снятие экипировки → `sfx.playUi('item_unequip')`

**Быстрый инвентарь** (`#inventory-bar`) — только предметы с `inventoryBar: true`.

---

## npc.js — NPC

Открывает диалог NPC: портрет, имя, чат (ввод сообщения + история). Торговцы (`type: "trader"`) — показывает магазин с ценами и кнопками «Купить»/«Продать». Полная механика NPC-боя (память, отношения, dream_ai) описана в [npc_combat.md](npc_combat.md); здесь — только клиентские точки входа.

- `openNpc()` → `sfx.playUi('npc_open')`
- `buyFromNpc()` → `sfx.playUi('item_buy')`
- `sellToNpc()` → `sfx.playUi('item_sell')`

`_showNpcNarration(npc)` — асинхронная, вызывается после открытия модала (пропускается, если модал открыт после скриптового события — см. ниже). Добавляет нарративный текст первым сообщением в `#npc-chat-log`. Использует секцию `NPC.trader` или `NPC.other` из `state.G.narrative` в зависимости от `npc.type`.

### `openNpc(instanceId)` — точка входа с учётом событий комнаты

Перед открытием модала проверяет хуки `state.G.currentRoom.npcEvents`:

1. **`on_first_encounter`** (срабатывает один раз) — если ещё не срабатывало, `fireEvent(...)` его прогоняет. `ends_with === 'combat'` → сразу `attackNpc(instanceId)`, модал чата не открывается. `ends_with === 'close'` → ничего не открывается. Иначе — модал открывается с `{ skipNarration: true }` (событие/диалог уже показали контекст встречи).
2. **`on_encounter`** (срабатывает при каждом взаимодействии) — та же логика, если `on_first_encounter` уже был использован (или отсутствует).
3. Если событий нет или все `once`-события исчерпаны — обычное открытие модала с нарративом (`_showNpcNarration`).

### `attackNpc(instanceId?)` — кнопка «⚔️ Напасть»

Кнопка `#btn-npc-attack` в левой колонке модала (видна только когда `data.npc.canAttack`, см. сервер). По клику или из `openNpc` (когда событие завершается `ends_with === 'combat'`):

```js
const data = await api('POST', '/api/npc/attack', { npcInstanceId: id });
state.G = data;
$('modal-npc')?.classList.add('hidden');
window.renderDungeon();
if (data.combatStarted || state.G.combat) window.enterCombat();
```

Модал может ещё не существовать, если бой запущен прямо из выбора в диалоге (`ends_with: "combat"`) без открытия чата NPC — код это учитывает (`?.`).

### `closeNpcModal()` — единая точка закрытия

Экспортируется и используется в трёх местах: кнопка «Закрыть», клик по фону модала, ESC (см. `main.js`). В отличие от программного скрытия модала при старте боя (`attackNpc`), здесь это осознанное закрытие пользователем — оно шлёт fire-and-forget запрос, запускающий на сервере асинхронную суммаризацию (`dream_ai`, см. [npc_combat.md](npc_combat.md)), на который клиент не ждёт ответа:

```js
export function closeNpcModal() {
  if (_currentNpc) api('POST', '/api/npc/close', { npcInstanceId: _currentNpc.instanceId }).catch(() => {});
  $('modal-npc')?.classList.add('hidden');
}
```

---

## map.js — Мини-карта

### `renderDungeonMap()`

Тайловая карта в `#dng-map` через абсолютное позиционирование. Вызывается из `dungeon.js` → `renderDungeon()`.

**Константы:**
```js
TILE    = 200  // px — размер тайла
CORR    = 25   // px — ширина коридора
OVERLAP = 50   // px — заход изображения коридора в тайл
PITCH   = TILE + CORR
```

**Пиксельные координаты:**
```js
px = CORR + (room.x - minX) * PITCH
py = CORR + (room.y - minY) * PITCH
```

**Классы комнат:** `fog` — не открыта, `adjacent` — соседняя (можно кликнуть, вешает `window.moveTo(dir)`), `current` — текущая (показывает пешку `pawn.png`, объекты и NPC комнаты кликабельны).

Боссы/мобы/NPC текущей и открытых комнат рисуются как отдельные `<img>` (`map-boss-pawn`, `map-mob-dot`, `map-npc-pawn`) поверх тайла; клик по NPC вызывает `window.openNpc(...)`, по объекту — `window.interactWith(...)`.

После рендера — плавный `scrollTo` к текущей комнате (`#dng-map-wrap`).

---

## skills.js — Дерево навыков

Рендерит три дерева (`battle`, `survival`, `magic`). Узлы расположены по координатам `position.x/y`. Подключённые узлы соединяются SVG-линиями. Доступные для покупки узлы подсвечиваются. Покупка — `POST /api/skill/learn` с `{ "skillId": "..." }`.

- Наведение на узел → `sfx.playUi('skill_hover')`
- Покупка навыка → `sfx.playUi('skill_learn')`

---

## saves.js — Сохранения

`openSavesList()` — загружает список из `/api/saves`, показывает модал. Каждое сохранение: дата, уровень, HP, XP. Кнопки «Загрузить» и «Удалить».

`loadSave(id)` — первым делом `if (!await ensureAiReady()) return;` (см. `ai_check.js`) — загрузка сохранения гейтится доступностью AI так же, как Continue/New Game в `main.js`.

`saveGame()` → `sfx.playUi('save_game')`

**`_savesFromGameover`** — флаг: модал сохранений открыт из модала поражения. При закрытии без выбора — модал поражения показывается снова.

---

## gameover.js — Заготовка анимации выхода

```js
export async function playDefeatExitAnimation()
```

Пока не делает ничего (no-op). Точка расширения под будущую анимацию выхода при поражении (например, «душа улетает» от тела). Вызывается и ожидается (`await`) из `main.js` перед скрытием `#modal-gameover` и переходом — в обработчиках `btn-go-load` и `btn-go-new` (загрузка сохранения / новая игра с экрана поражения). Не вызывается при `btn-go-continue` (продолжение той же сессии, поражения не было).

Аккаунтная статистика поражений (`totalDefeats`, см. `settings.js` → `_renderAccountStats`) считается на сервере — этот модуль с ней не взаимодействует, только резервирует место под визуальный эффект.

---

## credits.js — Титры

`initCreditsBtn()` — навешивает обработчики один раз: `#btn-credits` (внутри модала настроек) открывает титры, `#btn-credits-close` закрывает.

`openCredits()`:
1. Параллельно грузит `GET /api/credits` (секции/записи) и `GET /api/credits-tracks` (список треков).
2. Строит DOM титров (`_buildContent`): заголовок секции, опциональное изображение, записи `{ name, role, contribution }`, финальная благодарность (i18n `html.credits_thanks`).
3. Запускает вертикальную прокрутку (`_startRoll`) через двойной `requestAnimationFrame` (чтобы `offsetHeight` уже был посчитан) — движение с постоянной скоростью, замедляется вдвое (`V_SLOW` вместо `V_FAST`) когда первый заголовок секции доходит до центра экрана.
4. Приглушает игровую музыку (`music.suspend()`), проигрывает случайный трек из титров.

`closeCredits()` — останавливает `requestAnimationFrame`, скрывает модал, останавливает аудио, `music.unsuspend()`.

---

## settings.js — Настройки

`openSettings()` — параллельно грузит `GET /api/settings`, `GET /api/languages`, `GET /api/account`; заполняет поля, рендерит статистику аккаунта, инициализирует вкладки провайдера AI, кнопку теста модели, кнопку сброса аккаунта, графическую вкладку (Electron).

`saveSettings()` — читает все поля (включая провайдер AI и его под-режимы), отправляет (`POST /api/settings`), при смене языка шлёт `POST /api/language` и перезагружает страницу; иначе просто вызывает `music.setVolumes()` / `sfx.setVolume()` и закрывает модал.

`setSettingsTab(name)` / `setProviderTab(provider)` — переключение вкладок настроек (`lang`, `provider`, `graphics`, …) и вкладок AI-провайдера (`ollama` / `openrouter`) по `data-stab` / `data-provider`.

### Провайдер AI

Ollama имеет два под-режима — `local` / `cloud` (`.ollama-mode-btn`, `_applyOllamaMode`), переключающие видимость полей `#ollama-local-fields` / `#ollama-cloud-fields`. Собираются в `_collectProviderForm()` вместе с моделью, URL, ключами OpenRouter/Ollama Cloud и флагами JSON-режима.

### Кнопка «Тест модели» (`btn-ai-test`) — модал `#modal-ai-test`

Проверяет связь и качество ответов текущего (ещё не сохранённого) провайдера, не дожидаясь `saveSettings()`. Три последовательных шага (`AI_TEST_STEPS`: `basic`, `combat`, `perception`), каждый — отдельный запрос `POST /api/ai-test-step` с `{ step, ...form }`:

```js
for (const step of AI_TEST_STEPS) {
  _setAiTestStepState(step.id, 'running');
  const r = await api('POST', '/api/ai-test-step', { step: step.id, ...form });
  _setAiTestStepState(step.id, 'done', r.result);       // ✓/✗ + время в мс + detail
  _setAiTestProgress((i + 1) / AI_TEST_STEPS.length);   // #ai-test-progress-fill
  if (!r.result.ok) break;                              // остальные шаги остаются "pending"
}
```

По завершении всех шагов — `POST /api/ai-rate` с накопленными `results`, ответ — рейтинг качества (`{ score, ratingKey }`), отображается в `_showAiTestScore()`: числовой score + заголовок/описание по ключу `ai_rating_<ratingKey>_title|_desc` (i18n). Если рейтинг не пришёл — шаги всё равно остаются видимыми.

### Статистика аккаунта и сброс

`_renderAccountStats(acc)` — рендерит `#account-stats`: `totalDefeats`, `maxFloor`, `totalKills`, `totalSpared`, `totalBossKills`, `totalNpcMet`.

`btn-reset-account` — по подтверждению (`confirm()`) вызывает `POST /api/account/reset`, обнуляет `state.G`, перезагружает страницу (`window.location.reload()`).

### Графическая вкладка (только Electron)

`initGraphicsTab()` — активна только при `window.electronAPI`. Кнопки режима окна (windowed/borderless/fullscreen) и выпадающий список разрешений (отфильтрован по разрешению экрана из `electronAPI.getWindowInfo()`), применяются через `electronAPI.setWindowMode(mode, w?, h?)`.

**Слайдеры громкости** — живое обновление `%`-метки и громкости без сохранения на сервер.
- `inp-sfx-vol` → `sfx.setVolume(v)` (SFX-громкость)
- `inp-bg-vol`, `inp-bt-vol` → `music.setVolumes()`

**Кнопки play/stop** — превью музыки прямо в настройках.

---

## music.js — MusicManager

```js
const music = new MusicManager();
```

| Метод | Описание |
|-------|----------|
| `music.init()` | Загружает треки с `/api/music-tracks`, перемешивает bg-плейлист |
| `music.unlock()` | Вызывается при первом клике (обход Chrome autoplay) |
| `music.setVolumes(bgVol, btVol)` | Применяет громкость к текущему треку |
| `music.enterBattle()` | Останавливает bg, запускает случайный battle-трек |
| `music.exitBattle()` | Останавливает battle, возобновляет bg с того места |
| `music.previewBg(play)` | Превью фоновой музыки из настроек |
| `music.previewBattle(play)` | Превью боевой музыки из настроек |

**Плейлист:** треки bg идут последовательно (перетасованный массив, затем снова с начала). Battle — случайный трек. После боя bg возобновляется с того момента, где остановился.

---

## i18n.js — Локализация

При инициализации загружает строки UI с `/api/ui-strings` и подставляет их в элементы с `data-i18n="key"`. При смене языка перезагружает строки и переприменяет.

---

## preloader.js — Предзагрузка ассетов

При старте загружает список URL с `/api/preload-assets` и предварительно кеширует медиафайлы. Показывает прогресс-бар (CSS-анимация в `css/preloader.css`).

---

## animations/ — Визуальные эффекты вне игрового цикла

Не связаны напрямую с `state.G` — чисто декоративный слой, читают собственный манифест ассетов.

### `animations-entry.js`

Точка входа, импортируется из `main.js`-независимого контекста (подключается отдельно). Сейчас инициализирует только частицы меню:
```js
import { initMenuFallingParticles } from './particles/screen-menu-falling.js';
void initMenuFallingParticles();
```
Комментарий в файле резервирует место под будущие `./screen-combat-falling.js` и т.п.

### `particles/falling-particles-engine.js`

`createFallingParticles(layerEl, entries, options?) → { start(), stop(), destroy() }` — генератор падающих спрайтов (песок/валуны) внутрь `layerEl`. Каждая частица — `<img class="falling-particle">` со случайными CSS-переменными (`--xvw`, `--driftvw`, `--rot-end`, `--w`, `--scale0/1`, `--blur0/1`, `--op0/1`) и `animationDuration`; удаляется по `animationend`. `prune()` ограничивает число живых частиц (`maxAlive`). Принимает как простые строки-URL (легаси, вращающиеся «валуны»), так и объекты `{ url, spin, speed, driftVw, sizeMinPx/Max, ...fx }`.

### `particles/screen-menu-falling.js`

`initMenuFallingParticles()` — резолвит записи частиц через `particle-urls-by-scene.js`, создаёт движок для `#menu-falling-layer`. Включает/выключает поток частиц через `MutationObserver` за классом `.active` на `#screen-menu` (и на `visibilitychange` вкладки).

### `particles/particle-urls-by-scene.js`

Резолвит и нормализует манифест `assets/image/animated/particles/manifest.json` (`resolveMenuFallingParticles()`): пресеты по `mode` (`sand` / `boulder`), внешний вид (`appearance`: zoom/blur/opacity/opacityEnd — с алиасами `scale`/`blur`/`alpha`) наследуется с корня манифеста и может переопределяться отдельно для каждого item. При недоступности манифеста — фолбэк на `MENU_FALLING_PARTICLE_MANIFEST_FALLBACK` (пустой список).

---

## Экраны (SPA)

```
#screen-menu    — главное меню
#screen-dungeon — экран подземелья
#screen-combat  — экран боя
```

Только одному одновременно присвоен класс `.active` (CSS: `display: flex`).
