# Структура файлов проекта

```
dungeon-rpg/
│
├── server.js                      # Точка входа: meta → ai → game → inventory → combat → npc → event → dialogue → scavenge
├── package.json
│
├── public/                        # Статика — раздаётся браузеру
│   ├── index.html                 # Единственная HTML-страница (SPA)
│   ├── style.css                  # Все стили
│   ├── js/                        # ES-модули (type="module")
│   │   ├── main.js                # Инициализация, showScreen, глобальные обработчики
│   │   ├── state.js               # Глобальное состояние (G, busy)
│   │   ├── api.js                 # Обёртка fetch() для всех API-вызовов
│   │   ├── dom.js                 # Хелперы $() и $$()
│   │   ├── combat.js              # Бой: animateCombat, doTurn, handleCombatEnd
│   │   ├── dungeon.js             # Карта: renderDungeon, renderDungeonMap, moveTo
│   │   ├── inventory.js           # Инвентарь: renderInventoryModal, equip/use
│   │   ├── npc.js                 # NPC-диалог и торговля
│   │   ├── skills.js              # Дерево навыков: рендер и покупка
│   │   ├── saves.js               # Список сохранений, загрузка, удаление
│   │   ├── settings.js            # Настройки: модал, языки, громкость, тест AI-модели
│   │   ├── ai_check.js            # Проверка доступности AI перед входом в игру (Continue/New Game)
│   │   ├── gameover.js            # Экран поражения, учёт account-уровневых поражений, выход после смерти
│   │   ├── journal.js             # Журнал событий
│   │   ├── map.js                 # Мини-карта (отдельный виджет)
│   │   ├── music.js               # MusicManager — фон и боевая музыка
│   │   ├── sfx.js                 # SfxManager — звуковые эффекты (бой, UI, ховер)
│   │   ├── i18n.js                # Локализация: загрузка и применение ui-strings
│   │   ├── conditions.js          # resolveTextVariant: клиентская проверка условий нарратива
│   │   ├── dialogue.js            # Сценарный диалог: модал, start/advance/close API
│   │   ├── event.js               # Клиентский раннер событий (video/sound/music/dialogue)
│   │   ├── scavenge.js            # Интерактивный обыск комнаты (scavenge-сцены)
│   │   ├── credits.js             # Экран титров/благодарностей
│   │   ├── preloader.js           # Предзагрузка ассетов
│   │   └── devpanel.js            # Dev-панель (лог AI-вызовов), только если сервер в -developer
│   └── css/
│       ├── preloader.css
│       ├── animations-falling-particles.css
│       └── devpanel.css
│
├── server/
│   ├── engine/                    # Чистая игровая логика (без Express)
│   │   ├── data.js                # Загрузка всех манифестов при старте
│   │   ├── combat.js              # resolveTurn, checkLevelUp, E_COST
│   │   ├── items.js               # addToInventory, removeFromInventory, itemDef
│   │   ├── player.js              # recalcStats, effectiveAbility, resolveAbilities
│   │   ├── mob.js                 # spawnMob, buildMobFromBase, applyMobScript, deepMerge
│   │   ├── boss.js                # spawnBoss, buildBossFromBase, resolvePhases, applyPhase, checkPhases
│   │   ├── session.js             # newSession, slim/hydrate, pubSession, save/load
│   │   ├── dungeon.js             # generateDungeon (BFS + расстановка контента)
│   │   ├── ai.js                  # aiChat, mobSystempromt, parseMobReply, narrateText, AI-availability check
│   │   ├── npc.js                 # spawnNpc, npcSystempromt, spawnNpcCombat, dreamAboutEncounter (см. docs/npc_combat.md)
│   │   ├── account.js             # save/account.json — cross-save статистика, relationship/memory NPC
│   │   ├── helpers.js             # uid, rng, levelMatches, parseLevels, DELTA
│   │   ├── translation.js         # t(), setLang(), getSection(), LANGS, langName()
│   │   ├── conditions.js          # evalAll, applySet, resolveRef (серверные условия)
│   │   ├── dialogue.js            # startDialogue, advanceDialogue (сценарии из dialogue.json)
│   │   ├── devlog.js              # DEV_MODE, pushAiLog/getAiLog — лог AI-вызовов для dev-панели
│   │   └── event_engine.js        # resolveEvent — цепочки событий из event.json
│   └── routes/                    # Express-роутеры
│       ├── game.js                # /api/session, /api/new-game, /api/move, /api/interact, /api/save, /api/load
│       ├── ai.js                  # /api/ai-check, /api/ai-test-step, /api/ai-rate — доступность AI, тест модели
│       ├── dev.js                 # /api/dev/status, /api/dev/log, /api/dev/log/clear (только -developer)
│       ├── combat.js              # /api/combat/turn, /api/combat/flee, /api/combat/mercy, /api/narrate
│       ├── inventory.js           # /api/equip, /api/unequip, /api/use-item, /api/skill/learn
│       ├── npc.js                 # /api/npc/* (включая attack/close — см. docs/npc_combat.md)
│       ├── dialogue.js            # /api/dialogue/start, /api/dialogue/advance, /api/dialogue/close
│       ├── event.js               # /api/event/fire
│       ├── scavenge.js            # /api/scavenge/scene, /api/scavenge/interact, /api/scavenge/open-event
│       └── meta.js                # /api/settings, /api/saves, /api/skills, /api/media, /api/languages, …
│
├── assets/                        # Игровые данные и медиа (читаются сервером)
│   ├── player.json                # Базовые характеристики игрока
│   │
│   ├── config/
│   │   ├── core.json              # Боевая система: stats, ability, effects, звуки
│   │   ├── combat.json            # Визуальные параметры анимации боя
│   │   ├── progression.json       # Таблица уровней (XP, skillPoints, grants)
│   │   ├── dungeon_levels.json    # Размеры этажей / заранее собранные карты
│   │   ├── skills.json            # Конфигурация UI дерева навыков
│   │   ├── conditions.json        # Глобальные условия нарратива (berserk и др.)
│   │   ├── narrative.json         # AI-нарратор: перед/после боя, NPC (+ npc_trader_combat/npc_other_combat)
│   │   ├── dialogue.json          # Сценарные диалоги (before / script / outro)
│   │   ├── event.json             # События сюжета (actions, select, once)
│   │   ├── media.json             # Реестр sound/music/video (UI + event.json)
│   │   ├── npc_combat.json        # Relationship/memory/dream_ai — см. docs/npc_combat.md
│   │   └── ai_test.json           # Пороги и веса для теста AI-модели (settings)
│   │
│   ├── translation/               # Переводы (ui, items, skills, dialogue, scavenge, promts/…)
│   │   ├── ru/
│   │   └── en/
│   │
│   ├── scavenge/                  # см. docs/scavenge.md
│   │   ├── scenes/                # *.json + фоны *.jpg
│   │   └── objects/               # спрайты кликабельных объектов
│   │
│   ├── skills/
│   │   └── manifesto.json         # Дерево навыков (battle / survival / magic)
│   │
│   ├── mob/
│   │   ├── manifesto.json         # Список всех мобов
│   │   └── <папки мобов>/         # PNG/WebP-спрайты + effects/
│   │
│   ├── boss/
│   │   ├── manifesto.json         # Список боссов (с фазами)
│   │   └── <папки боссов>/        # PNG/WebP-спрайты + effects/
│   │
│   ├── item/
│   │   ├── manifesto.json         # Предметы (items + object)
│   │   └── *.png                  # Иконки предметов
│   │
│   ├── object/
│   │   └── manifesto.json         # Объекты мира (сундуки, двери, ключи)
│   │
│   ├── map/
│   │   ├── manifesto.json         # Тайлы и переходы
│   │   └── *.png                  # Тайлы комнат
│   │
│   ├── npc/
│   │   └── manifesto.json         # NPC-персонажи
│   │
│   ├── player/                    # Спрайты игрока
│   │   ├── Player_animated.webp
│   │   ├── Player_attack.png
│   │   ├── Player_defend.png
│   │   ├── Player_dead.png
│   │   ├── Player_magical_attack.png
│   │   ├── pawn.png
│   │   └── effects/
│   │       ├── heal.png
│   │       └── crit.png
│   │
│   ├── image/                     # UI-иконки, фоны, иконки способностей
│   │   ├── abilities/
│   │   └── background/
│   │
│   ├── sound/
│   │   ├── background_music/      # Треки фоновой музыки (mp3/ogg/wav)
│   │   ├── battle/                # Треки боевой музыки
│   │   └── ui/                    # Звуковые эффекты (способности, интерфейс)
│   │
│   └── level_plan/                # Заранее собранные карты этажей (JSON)
│
├── lore/                          # Контекст для AI-диалогов (info_promt_world.md)
│
└── save/                          # Сохранения и конфиг (создаётся автоматически)
    ├── config.json                # Настройки (провайдер, модель, громкость, язык)
    ├── .session.json              # Автосохранение текущей сессии
    └── YYYY-MM-DD-HH-MM-SS/      # Именованное сохранение
        ├── player.json
        ├── world.json
        └── journal.json
```

---

## Размеры спрайтов

| Тип | Размер | Примечание |
|-----|--------|-----------|
| Тайл комнаты | 550×550 px | Отображается ~170×170 px на карте |
| Переход (горизонт.) | 145×450 px | Коридор между тайлами |
| Переход (вертик.) | 450×145 px | |
| Боевой спрайт моба / босса | 510×850 или 850×850 | Масштабируется до max 180 px |
| Иконка предмета | любой | Масштабируется до 38×38 px |
| Пешка на карте | любой | ~52% от тайла |
