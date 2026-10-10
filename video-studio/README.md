# video-studio

Конвейер «тема → готовый ролик» на бесплатных инструментах:

```
тема ──LLM──▶ сценарий (JSON) ──TTS──▶ озвучка + тайминги слов
                                   ──стоки/AI──▶ визуал сцен
                                   ──▶ музыка, звук переходов
                    ──Remotion (моушен-графика)──▶ video.mp4 + обложки + субтитры + описание
                                                   ──▶ YouTube (в слоты 12:00/19:00) + Instagram Reels + канал Telegram
```

- **Основной формат — Shorts 1080×1920**, есть и горизонтальный 1920×1080.
- Ролики на русском: кинетическая типографика, счётчики, списки, цитаты, субтитры в стиле TikTok
  с подсветкой слова, плавные переходы, фоновая музыка с приглушением под голос.
- Всё по умолчанию **бесплатно**. Платное (Claude, ElevenLabs) включается только явно, и тогда
  стоимость каждого запуска пишется в `cost.json`.
- Работает на Windows, Linux и в GitHub Actions. Системный ffmpeg не нужен: Remotion везёт свой,
  браузер для рендера скачивается сам при первом запуске.

Проект отдельный от Next.js-приложения в родительской папке и ничего у него не берёт.

**Канал «Суть за минуту».** Название, голос (Gemini Charon), палитра, хэштеги, призывы, ссылки,
дисклеймер и время выхода (2 ролика в день: 12:00 и 19:00 по Москве) записаны в `channel.json`.
Конвейер берёт их оттуда сам. Переменные окружения (`CHANNEL_NAME`, `GEMINI_TTS_VOICE`,
`PUBLISH_TIMES`…) сильнее файла. Пошаговые инструкции для человека:

- [docs/youtube-setup.md](docs/youtube-setup.md) — оформить канал в YouTube Studio и публиковать по расписанию;
- [docs/instagram-setup.md](docs/instagram-setup.md) — Reels через официальный API или вручную;
- [docs/telegram-setup.md](docs/telegram-setup.md) — ролики в канал Telegram через своего бота;
- [brand/README.md](brand/README.md) — аватар, баннер, водяной знак, обложки «Актуального».

---

## Чего ждать по качеству (честно)

**Картинка.** Моушен-графика на тёмных градиентах с иконками: аккуратно и динамично, но узнаваемо
«шаблонно». Со стоковыми видео (Pexels/Pixabay) ролики заметно живее, поэтому ключи Pexels и
Pixabay стоит завести сразу: они бесплатные. Без них кадры берутся только из Wikimedia Commons и
Openverse, и только по теме сцены; остальные сцены — на моушен-графике. Подробно и пошагово —
[docs/visuals.md](docs/visuals.md).

**Голос** решает больше всего:

| Провайдер | Как звучит | Ограничения |
|---|---|---|
| **edge** (по умолчанию без ключа Gemini) | Хороший нейроголос (Дмитрий, Светлана): ровный, «дикторский», мало эмоций. Тайминги слов точные — от сервиса | Неофициальный доступ к сервису Microsoft: может перестать работать без предупреждения, а условия Microsoft такое использование прямо не разрешают. Если Edge не отвечает, конвейер сам переозвучит ролик через Piper |
| **piper** | Заметно роботизированный, бывают ошибки в ударениях. Годится для черновиков и как запасной | Работает офлайн. Модель (~60 МБ) скачивается сама. Лицензии датасетов: dmitri и denis — CC0, irina — не указана, ruslan — CC BY-NC-SA (только некоммерчески) |
| **gemini** (по умолчанию, если задан `GEMINI_API_KEY`) | Самый живой из бесплатных, голос по умолчанию — **Charon** (глубокий мужской); слушается подсказки по стилю (`GEMINI_TTS_STYLE`) | Бесплатная квота AI Studio — **около 10 запросов в сутки на модель** (проверено 07.10.2026). Поэтому весь ролик озвучивается **одним запросом** и режется на сцены по паузам: ≈ 10 Shorts в сутки. Кончилась квота — ролик целиком переозвучит Edge (затем Piper), в `qc.json` и сводке запуска будет пометка; с `TTS_FALLBACK=none` (так собирает автопилот панели) сборка вместо этого падает и повторяется на следующий день. Уже озвученный текст берётся из кэша (`.cache/voice`) и квоту не тратит. Тайминги слов оцениваются по звуку |
| **elevenlabs** | Лучшее качество | Бесплатный план — **без коммерческих прав** и с обязательной атрибуцией. Для монетизируемого канала нужен платный план (от ~$5/мес) |
| **openai** | Зависит от модели. Qwen3-TTS (Apache-2.0) умеет клонировать ваш голос по образцу | Нужен свой сервер с видеокартой (Colab/Kaggle/свой ПК), см. `.env.example` |
| **fish** | Хорошее качество, клонирование | Веса Fish Speech — некоммерческая лицензия |

**Скорость.** Рендер — 90–95 % времени сборки. Замеры 09–10.10.2026 в GitHub Actions: 2 ядра,
бесплатный раннер приватного репозитория, `VIDEO_QUALITY=high`.

| Что в кадре | Скорость | Shorts 50–65 с |
|---|---|---|
| Фото | 4,3–5,4 кадра/с | рендер 5–6,5 мин |
| Видеоклипы стоков | 2,6–2,9 кадра/с: каждый клип ещё и декодируется | рендер 8,5–9 мин |

- Вместе с установкой — 6–10 минут на ролик.
- Горизонтальный ролик на 7–8 минут (12 600–14 400 кадров) — около 40–90 минут рендера. Это
  оценка по тем же скоростям, а не замер.
- Локально на 4 ядрах без визуала — ≈ 8 кадров/с.

---

## Быстрый старт на Windows

1. Поставьте **Node.js 22 LTS или новее** с [nodejs.org](https://nodejs.org) (кнопка LTS).
2. Скачайте репозиторий: `git clone …` или «Code → Download ZIP», распакуйте **в путь без
   пробелов и кириллицы**, например `C:\video\yt-planner`.
3. В PowerShell:
   ```powershell
   cd C:\video\yt-planner\video-studio
   npm ci
   copy .env.example .env      # откройте .env в Блокноте и заполните нужное
   npm run make -- --demo
   ```
4. Через пару минут готовый ролик будет лежать в `out\pochemu-ty-zabyvaesh-66-vyuchennogo-za-sutki\video.mp4`.
   При первом запуске скачивается Chrome Headless Shell (~100 МБ) — это нормально.

Чтобы ролик писал ИИ, нужен бесплатный ключ Gemini
([aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)) в `.env` → `GEMINI_API_KEY=…`:

```powershell
npm run make -- --topic "Почему мы забываем выученное"
```

Переменные окружения в PowerShell задаются так: `$env:TTS_PROVIDER="piper"; npm run make -- --demo`.

**Слабый ПК:** `RENDER_CONCURRENCY=1` (меньше нагрузка), `VISUALS_PREFER=image` (без видеоклипов —
их декодирование тяжелее всего). Длинные ролики лучше рендерить в GitHub Actions.

---

## Команды

| Команда | Что делает |
|---|---|
| `npm run make -- --demo` | Демо-ролик из `examples/demo-ru.json` |
| `npm run make -- --topic "тема" [--format landscape] [--notes "…"] [--seconds 60]` | Полный автомат: сценарий от LLM → видео |
| `npm run script -- --topic "тема" [--format …] [--notes "…"]` | Только черновик сценария → `scripts/<имя>.json` |
| `npm run script -- --long-plan L01` | «Разбор» по теме длинного плана → `scripts/razbor-L01-<имя>.json` (см. «Разборы») |
| `npm run plan-extend -- --long --count 6` | Новые темы «Разбора» в `content/long-plan.json` (без `--long` — темы Shorts в `plan.json`) |
| `npm run make -- --script scripts/<имя>.json` | Видео по вашему (отредактированному) сценарию |
| `npm run upload -- out/<имя> [--privacy unlisted] [--schedule]` | Загрузить готовый ролик на YouTube (`--schedule` — в ближайший слот 12:00/19:00 МСК) |
| `npm run upload -- out/<имя> --to instagram` | Опубликовать Reels в Instagram (`--to youtube,instagram` — в оба) |
| `npm run upload -- out/<имя> --to telegram` | Отправить ролик в канал Telegram (можно вместе: `--to youtube,telegram`) |
| `npm run youtube-auth` | Разовая настройка входа в YouTube (печатает `YT_REFRESH_TOKEN`) |
| `npm run instagram-token [-- --exchange --page --save]` | Токен Instagram: проверить срок, продлить, узнать `IG_USER_ID` |
| `npm run telegram-check` | Бот Telegram: проверить токен и права в канале, узнать `TELEGRAM_CHAT_ID` |
| `npm run studio` | Remotion Studio — посмотреть композицию в браузере на демо-данных |
| `npm run browser` | Заранее скачать браузер для рендера |
| `npm run typecheck` | Проверка типов |

Другие параметры `make`: `--theme midnight|sunset|emerald|mono`, `--voice edge|piper|gemini|…`,
`--mood calm|inspiring|upbeat|tech|dark`, `--out папка`, `--no-render` (всё, кроме рендера),
`--concurrency N`, `--upload youtube|instagram|telegram` (можно через запятую), `--privacy private|unlisted|public`,
расписание YouTube: `--schedule` (ближайший свободный слот), `--schedule-slot N` (N-й слот подряд),
`--schedule-start 2026-10-14`, `--publish-at <ISO-время>`. Справка: `npm run make -- --help`.

**Что получается** в `out/<имя-ролика>/`:

| Файл | Зачем |
|---|---|
| `video.mp4` | Ролик (H.264 + AAC, BT.709, громкость поднята к ≈ −14 LUFS без компрессии, но не выше пика −1,5 dBTP: голос уже ограничен по пикам, поэтому на деле ≈ −16 LUFS) |
| `thumbnail.png` | Обложка 1280×720 (для YouTube при размере больше 2 МБ дополнительно `thumbnail.jpg`) |
| `captions.srt` | Субтитры для YouTube (в само видео субтитры уже вшиты) |
| `description.txt` | Название, описание (призыв, ссылки, хэштеги канала, источники, дисклеймер), теги — для вставки в YouTube Studio |
| `instagram.txt` | Подпись для Reels: хук, суть, призыв, 5–8 хэштегов из `channel.json`, без ссылок, ≤ 2200 символов. Можно править перед публикацией |
| `cover.jpg` | Обложка Reels 1080×1920 — кадр конца хука без субтитров (тот же кадр API ставит обложкой) |
| `youtube-result.json`, `instagram-result.json`, `telegram-result.json` | Что и когда опубликовано (защита от повторной публикации) |
| `cost.json` | Сколько стоил запуск: токены и деньги LLM, символы озвучки |
| `script.json`, `props.json` | Сценарий и полная таймлиния — чтобы пересобрать или разобраться |
| `public/` | Озвучка, визуал и музыка запуска. Повторная сборка того же сценария не озвучивает сцены заново и берёт уже найденные клипы для сцен, у которых не менялись `visualQuery`/`imagePrompt` (подобрать заново — удалите `public/visuals`) |
| `source.json` | Откуда сценарий. Другой сценарий с тем же названием не затирает ролик, а попадает в `out/<имя>-2` |

---

## Рабочий процесс: черновик → правка → рендер

```
npm run script -- --topic "…"   →   правите scripts/<имя>.json   →   npm run make -- --script scripts/<имя>.json
```

Почему не «тема → сразу на YouTube»:

- **Политика YouTube о неаутентичном контенте** (раньше «повторяющийся контент», с июля 2025 —
  «inauthentic content») снимает с монетизации массовые однотипные ролики без вклада автора.
  Автоматизация сама по себе не запрещена, но нужны ваша мысль, проверенные факты и разнообразие.
- **LLM ошибается в фактах.** Промпт запрещает выдумывать цифры и цитаты, но проверить
  может только человек. Цифры в `stat`-сценах и цитаты проверяйте всегда.
- Правка 5 минут в JSON (своя формулировка, пример из жизни, уточнение) заметно поднимает
  удержание зрителя.

Формат сценария — см. `examples/demo-ru.json` и комментарии в `src/types.ts`. Главное:

- `narration` — что говорит диктор, полными предложениями, **числа словами**;
- `onScreen` — 3–8 слов на экране, одно `*акцентное*` слово;
- `kind` — тип сцены: `hook` (первая), `statement`, `list` (+`items`), `stat` (+`stat`), `quote`,
  `media`, `cta` (последняя);
- `visualQuery` — английский запрос к стокам; `icon` — имя иконки [lucide](https://lucide.dev/icons) в kebab-case.

Ошибку в JSON `make` покажет списком по-русски, ничего не рендеря.

Ролики с синтезированным голосом при загрузке через API помечаются как «изменённый или
синтетический контент» (`YT_SYNTHETIC_MEDIA=0` — отключить): так честнее, и этого требуют
правила YouTube для реалистичного ИИ-контента.

---

## GitHub Actions: рендер в облаке и запуск с телефона

Workflow: `.github/workflows/video-studio.yml` (в корне репозитория).

### Настройка (один раз)

1. Залейте репозиторий на GitHub. **Кнопка «Run workflow» появляется только тогда, когда файл
   workflow лежит в ветке по умолчанию** (обычно `main`/`master`).
2. **Settings → Secrets and variables → Actions → Secrets → New repository secret.** Нужны только те,
   что вы используете:

   | Секрет | Для чего | Где взять (бесплатно) |
   |---|---|---|
   | `GEMINI_API_KEY` | Сценарии (и Gemini TTS) | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
   | `PEXELS_API_KEY` | Стоковые видео и фото — главное для кадров по теме ([docs/visuals.md](docs/visuals.md)) | [pexels.com/api](https://www.pexels.com/api/) |
   | `PIXABAY_API_KEY` | Ещё стоковые видео | [pixabay.com/api/docs](https://pixabay.com/api/docs/) |
   | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | AI-картинки (FLUX) | dash.cloudflare.com → Workers AI |
   | `GROQ_API_KEY`, `OPENROUTER_API_KEY` | Запасные LLM | console.groq.com, openrouter.ai |
   | `ANTHROPIC_API_KEY` | Claude (платно) | platform.claude.com |
   | `ELEVENLABS_API_KEY` | ElevenLabs | elevenlabs.io |
   | `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` | Загрузка на YouTube | см. «Загрузка на YouTube» |
   | `IG_USER_ID`, `IG_ACCESS_TOKEN` | Публикация Reels в Instagram | [docs/instagram-setup.md](docs/instagram-setup.md) |
   | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Ролики в канал Telegram (workflow «Telegram по расписанию») | [docs/telegram-setup.md](docs/telegram-setup.md) |

3. **Variables** (вкладка рядом, необязательно): `CHANNEL_NAME` (имя канала в финальной сцене),
   `LLM_PROVIDER`, `LLM_MODEL`, `LLM_FALLBACKS`, `LLM_EFFORT`, `VISUALS`, `VISUALS_PREFER`,
   `VISUALS_JUDGE` (`claude` — судья Claude для кадров, платно), `VISUALS_JUDGE_MODEL`, `VISUALS_MIN_PHOTO_PX`,
   `TTS_PROVIDER` (только для расписания — при ручном запуске провайдер и голос выбираются кнопкой: поля «Озвучка» и «Голос»), `TTS_VOICE`,
   `TTS_RATE`, `TTS_FALLBACK`, `TTS_CACHE`, `TTS_CACHE_DAYS`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE`, `GEMINI_TTS_STYLE`,
   `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`, `MUSIC`, `MUSIC_MOOD`, `LOUDNESS_TARGET`,
   `RENDER_CONCURRENCY`, `YT_CATEGORY_ID`, `YT_SYNTHETIC_MEDIA`, `PUBLISH_TIMES`, `PUBLISH_TZ`,
   `IG_API_VERSION`, `IG_AI_GENERATED`, `SCHEDULED_TOPIC` (тема для запуска
   по расписанию). Других имён из `.env.example` workflow не читает. Секрет `GOOGLE_API_KEY`
   принимается вместо `GEMINI_API_KEY`.
4. Если черновик не пушится (ошибка 403): **Settings → Actions → General → Workflow permissions →
   Read and write permissions**.

### Запуск (в том числе с телефона)

На github.com (в браузере телефона или в приложении GitHub; если в приложении нет кнопки, откройте
сайт): **Actions → «video-studio: ролик» → Run workflow**.

1. **mode = draft**, **topic** = тема → через ~1 минуту в ветке появится `video-studio/scripts/<имя>.json`.
   Ссылка «✏️ редактировать» — в сводке запуска (Summary). Правьте прямо на github.com и нажимайте
   «Commit changes».
2. **mode = render**, **script** = `video-studio/scripts/<имя>.json` → через ~6–8 минут ролик готов.
   - **upload = none** — ролик в артефакте запуска (Summary → Artifacts, zip, хранится 7 дней);
   - **upload = release** — ещё и в релизе GitHub: mp4 можно скачать и посмотреть прямо с телефона,
     хранится, пока вы не удалите релиз. **Удобнее всего с телефона;**
   - **upload = youtube** — на YouTube с выбранной видимостью (см. ограничения ниже); с
     **schedule = slots** — приватно до ближайшего свободного слота 12:00/19:00 МСК, потом YouTube
     опубликует сам;
   - **upload = instagram** — сразу в Instagram Reels (варианты `youtube+instagram`, `release+…` —
     в несколько мест сразу).
3. **mode = batch**, **script** = `video-studio/scripts/sut-01*.json` (маска или список через запятую) →
   ролики собираются по очереди в одном запуске. С **schedule = slots** каждый встаёт в свой слот
   подряд: 12:00, 19:00, завтра 12:00… (**schedule_start** = `2026-10-14` — считать слоты с этой
   даты). С `instagram` в **upload** ролики ложатся в очередь (релизы GitHub с `instagram.json`), а
   публикует их по одному workflow **«video-studio: Instagram по расписанию»** — вручную или по
   расписанию (раскомментируйте `schedule` в `.github/workflows/video-studio-instagram.yml`).
   Пакет — до 8–10 роликов: на больше не хватит суточной квоты голоса Gemini. Подробно:
   [docs/youtube-setup.md](docs/youtube-setup.md), [docs/instagram-setup.md](docs/instagram-setup.md).
4. **voice_fallback** — что делать, если кончилась квота Gemini: **auto** (по умолчанию) — озвучить
   запасным голосом Edge/Piper (в `qc.json` релиза поле `voice` с `fallback: true`, в сводке — «⚠»);
   **none** — не подменять: ролик падает с «квота Gemini закончилась — ролик соберётся при повторе».
   Автопилот панели запускает с **none**.

Озвученные сцены кэшируются между запусками (`actions/cache`, папка `video-studio/.cache/voice`,
14 дней): пересборка и повтор упавшего запуска того же текста квоту Gemini не тратят — но и дубль
голоса берут тот же. Нужен новый (оговорка, обрезанное слово) — переменная репозитория
`TTS_CACHE` = `0` на одну пересборку (потом удалите) или правка текста сцены.

Без `script`, но с `topic` render делает всё сам; без обоих — демо-ролик. **format = auto** берёт формат
из сценария (для темы без сценария — Shorts); горизонтальный ролик по теме — **format = landscape**.
Лимит времени: черновик — 40 минут, сборка — 2 часа (8-минутный горизонтальный ролик на 2 ядрах
рендерится ≈ 45–90 минут), пакет — почти 6 часов (6–10 минут на Shorts).

### Лимиты бесплатного плана

- **Минуты:** приватный репозиторий — 2000 минут в месяц на раннерах с 2 ядрами (≈ 200–300 Shorts пакетами);
  публичный — без лимита, раннеры с 4 ядрами.
- **Хранилище артефактов** на бесплатном плане — 500 МБ, но считается не «сколько лежит сейчас», а
  накопленные за месяц ГБ·часы: удаление артефакта уже израсходованное не возвращает. При хранении
  7 дней на месяц хватает примерно на 35 Shorts (50–75 МБ при `VIDEO_QUALITY=high`) или на 2–3
  восьмиминутных ролика (≈ 0,4–0,6 ГБ — оценка по битрейту Shorts); квота сбрасывается
  только с новым расчётным периодом. Когда она кончится, артефакт не сохранится (в сводке будет
  предупреждение), но релиз и YouTube всё равно получат видео. Что нужно надолго — отправляйте в
  релиз (`upload = release`, релизы в эту квоту не входят; артефакт тогда хранится сутки).
- Одновременно идёт один запуск, остальные (до 100) ждут в очереди по порядку.
- Расписание: раскомментируйте блок `schedule` в workflow и задайте переменную `SCHEDULED_TOPIC`.

---

## «Разборы»: длинные ролики 16:9 по вторникам, четвергам и субботам

Третий поток канала рядом с двумя Shorts в день: **«Разбор»** — горизонтальный ролик на ~7 минут
(25–45 сцен, главы с карточками и таймкодами в описании) **на свою тему, которой нет среди Shorts**.
Выход — **вт, чт, сб в 21:00 МСК** (`channel.json` → `longSlots`; часовой пояс — из `schedule`).

| Шаг | Как |
|---|---|
| Темы | `content/long-plan.json`: коды `L01`, `L02`… по порядку выхода, у темы 8–12 фактов с источниками (живых ссылок — минимум 6) и набросок глав `chapters`. Новые: `npm run plan-extend -- --long --count 6` или Actions → «video-studio: план тем» → **long = true** (пачками по 3 темы, без повторов тем и фактов Shorts и прошлых «Разборов»). Автопилот панели заказывает 6 тем сам, когда без сценария остаётся меньше трёх |
| Сценарий | `npm run script -- --long-plan L01` (или `--plan L01`) → `scripts/razbor-L01-<имя>.json`; в длинном плане тема получает `status: script-ready` |
| Видео | Actions → «video-studio: ролик» → **mode = batch**, **plan = L01**, **upload = release** (формат 16:9 берётся из сценария) → в релизе `L01-<имя>.mp4`, `thumbnail.png` 1280×720 (и `thumbnail.jpg`, если PNG больше 2 МБ), тексты — в `content/videos.json` |
| YouTube | Загрузите `L01-….mp4` в Studio руками → в панели «Найти новые загрузки»: название, описание с таймкодами, теги, время ближайшего свободного слота «Разборов» (никогда не слот Shorts) и **своя обложка из релиза** (`thumbnails.set`, 50 единиц квоты). Свои обложки YouTube разрешает только подтверждённому каналу (youtube.com/verify) — иначе панель так и скажет, обложку тогда ставят в Studio руками |

**Бюджет бесплатных лимитов.** Озвучка «Разбора» — ~7000 символов, это ≈ 3 запроса Gemini TTS из
~10 в сутки (Shorts — 1 запрос), поэтому автопилот собирает не больше одного «Разбора» за раз и в
этот день — не больше 3 Shorts. Сборка в GitHub Actions — 45–90 минут: оценка по замеренной
скорости рендера — 5 кадров/с с фото, 2,7 с видеоклипами стоков.
- 3 «Разбора» в неделю ≈ 13 в месяц ≈ 585–1170 минут.
- 60 Shorts ≈ 360–600 минут (6–10 минут на ролик).
- Вместе — около 950–1770 из 2000 бесплатных минут приватного репозитория. Чем больше сцен с
  видео, тем ближе к пределу. «Разборы» не уходят в очереди Telegram и Instagram (там только
`08a-….mp4`), другие языки (`--lang`) для них пока не поддержаны.

Коды обоих видов разбирает один модуль — `src/pipeline/codes.ts` (`08a` — Shorts, `L01` —
«Разбор»); youtube-fill, панель, релизы и названия запусков («batch: L01») узнают ролик по нему.

---

## Загрузка на YouTube

1. [console.cloud.google.com](https://console.cloud.google.com) → создайте проект → **APIs & Services →
   Library → YouTube Data API v3 → Enable** (и **YouTube Analytics API** — удержание в панели).
2. **OAuth consent screen**: тип External, добавьте свой Gmail в Test users. Затем **Publish app**
   (статус «In production»): в режиме Testing токен перестаёт работать через 7 дней.
   Проверку Google для личного использования проходить не нужно, будет только предупреждение
   «приложение не проверено».
3. **Credentials → Create credentials → OAuth client ID → Desktop app.** Client ID и Client secret
   запишите в `.env` как `YT_CLIENT_ID` и `YT_CLIENT_SECRET`.
4. На своём ПК выполните `npm run youtube-auth`. Откроется браузер; войдите в аккаунт с каналом.
   В терминале появится `YT_REFRESH_TOKEN=…`: добавьте его в `.env` (или запустите с `--save`)
   и в секреты GitHub.
   Без компьютера ключ можно получить в браузере через OAuth Playground: [docs/youtube-setup.md](docs/youtube-setup.md), шаг 6.
5. Загрузка: `npm run upload -- out/<имя> --privacy unlisted` или `npm run make -- … --upload youtube`.
   Загрузили ролики в Studio руками — тексты и расписание поставит `npm run youtube-fill` (или
   workflow «video-studio: YouTube — тексты и расписание»): см. docs/youtube-setup.md.
6. По расписанию: `--schedule` (ближайший свободный слот из `channel.json`), `--schedule-slot N`,
   `--publish-at 2026-10-10T12:00:00+03:00`. Видео загружается приватным с `publishAt`, и YouTube
   сам публикует его в это время. Как это выглядит в Studio: [docs/youtube-setup.md](docs/youtube-setup.md).

Важно знать:

- **Видео из непроверенного проекта Google Cloud YouTube делает приватными**, даже если вы просили
  public. Видимость меняется вручную в YouTube Studio за секунду. Снять ограничение можно только
  аудитом API у Google.
- Загрузка идёт частями по 8 МБ и при обрыве продолжается с того же места. Категория — «Образование»
  (`YT_CATEGORY_ID`), «не для детей», отметка о синтетическом контенте.
- Свою обложку API ставит только на канал, подтверждённый по телефону. У Shorts обложку выбирают в
  приложении YouTube. Если поставить её не удалось, загрузка всё равно считается успешной.
- Суточная квота YouTube Data API — 10 000 единиц; с декабря 2025 года загрузка стоит ≈ 100 единиц
  (раньше 1600), так что двух роликов в день квота не замечает. При превышении будет понятная
  ошибка; квота обновляется в полночь по тихоокеанскому времени.
- **Расписание и непроверенный проект Google.** Пока проект не прошёл аудит API, YouTube запирает
  загруженные через API ролики как приватные, и `publishAt` может не сработать (в логе будет
  предупреждение). Тогда время ставится в Studio вручную, около 10 секунд на ролик: см.
  [docs/youtube-setup.md](docs/youtube-setup.md), «Важно: проверка проекта Google».

---

## Субтитры на других языках

`npm run captions-translate -- 08a,08b --langs en,kk,uz [--dry-run]` (или workflow «video-studio:
субтитры на других языках»): русский `captions.srt` ролика (из `out/<ролик>/` или из его релиза) →
перевод LLM с теми же репликами и таймингами → `captions.en.srt`… → дорожки «English (AI)»,
«Қазақша (AI)»… у ролика на YouTube (ролик ищется по коду, как в youtube-fill). Повторный запуск
безопасен: готовые переводы и загруженные дорожки пропускаются. Квота: ~400 единиц за дорожку
(≈ 20 дорожек в сутки). `--no-upload` — только файлы.

Нужно право **youtube.force-ssl**. Ключи, выпущенные раньше, его не имеют — один раз:

1. На ПК: `npm run youtube-auth -- --save` и в окне Google оставьте отмеченными все галочки.
2. Новый `YT_REFRESH_TOKEN` из `.env` — в секреты GitHub (Settings → Secrets and variables →
   Actions), в Vercel (проект панели → Settings → Environment Variables → `YT_REFRESH_TOKEN`, затем
   Redeploy) и в `video-studio/.env` на втором компьютере.

## Ролики на других языках

Основа для каналов на английском, казахском, узбекском (и uk, es, de, fr, pt, tr):

- `npm run script -- --plan 08a --lang en` — русский сценарий темы переводится (те же сцены, факты и
  числа; хук и призыв — как у носителя языка), а если его нет — пишется сразу на этом языке по
  плану. Файл — `scripts/en/sut-08a-<имя>.json` (план и русские сценарии не меняются).
- `npm run make -- --script scripts/en/sut-08a-<имя>.json` — язык берётся из сценария: канал
  `channels/en.json` (та же схема, что `channel.json`: имя, хэштеги, призывы, подвал, дисклеймер),
  голос языка (Gemini — тот же Charon; для kk и uz Gemini TTS нет — Edge `kk-KZ-DauletNeural`,
  `uz-UZ-SardorNeural`), подписи в кадре («Subscribe», «FACT OR MYTH?»). Свой файл канала —
  `CHANNEL_FILE`.
- В GitHub Actions: workflow «video-studio: ролик», поле **lang** (draft / render / batch). В релизе
  файл называется `en-08a-<имя>.mp4` — панель и youtube-fill его не трогают (их ролики — `08a-….mp4`).

Загрузки в эти каналы нет: у каждого канала свой ключ YouTube, а `--upload` и upload = youtube /
instagram для других языков выключены. Что сделать владельцу:

1. Создать канал (лучше — отдельный бренд-аккаунт), заполнить `channels/<язык>.json`: `name`,
   `handle`, `links`, проверить тексты (kk, uz — носителю языка), удалить `_todo` и `placeholder`.
2. Пока — собирать с upload = release и загружать `en-08a-….mp4` в Studio нового канала руками,
   тексты — из `description.txt` релиза.
3. Позже, для автозагрузки, — отдельный ключ: `npm run youtube-auth` с входом в новый канал и свои
   секреты (например, `YT_REFRESH_TOKEN_EN`); подключение к workflow — отдельная задача.

---

## Instagram Reels

Официальный API Meta, вариант **«Instagram API with Facebook Login for Business»**
(`graph.facebook.com`): только он загружает **локальный файл** (resumable upload на
`rupload.facebook.com`) без публичной ссылки на видео. Нужны профессиональный аккаунт Instagram,
связанная страница Facebook и токен с `instagram_basic`, `instagram_content_publish`,
`pages_read_engagement`, `pages_show_list`. Все шаги для человека:
[docs/instagram-setup.md](docs/instagram-setup.md).

- `npm run upload -- out/<имя> --to instagram` — контейнер Reels → загрузка файла → ожидание
  обработки → публикация. Подпись — `instagram.txt`, обложка — тот же кадр, что `cover.jpg`
  (`thumb_offset`), пометка «создано с ИИ» (`IG_AI_GENERATED=0` — без неё). Звук перед отправкой
  перекодируется в AAC 128 кбит/с: так требует Meta.
- Повторная публикация того же ролика блокируется (`instagram-result.json`, ещё раз — `--force`),
  а перед публикацией подпись сверяется с последними постами: после обрыва связи дубля не будет.
- Отложенной публикации в API Instagram нет. Расписание делает workflow «video-studio: Instagram
  по расписанию» (очередь в релизах GitHub), или ставьте время сами в приложении Instagram.
- Токен пользователя живёт ~60 дней: `npm run instagram-token -- --exchange`. Токен страницы
  (`--page`) не истекает.

---

## Telegram

Официальный Bot API (`api.telegram.org`, `sendVideo`): свой бот от @BotFather — администратор
канала с правом «Публикация сообщений». Включается только ключами `TELEGRAM_BOT_TOKEN` и
`TELEGRAM_CHAT_ID`. Все шаги: [docs/telegram-setup.md](docs/telegram-setup.md).

- `npm run upload -- out/<имя> --to telegram` — видео с размерами и потоковым воспроизведением,
  подпись `telegram.txt` или `instagram.txt` (до 1024 символов, длинная сокращается по абзацам),
  обложка `cover.jpg`. Файл больше 50 МБ (лимит ботов; рендер по умолчанию ≈ 11 Мбит/с) сам
  пережимается в копию ≈ 45 МБ ffmpeg'ом из Remotion.
- Повтор того же ролика блокирует `telegram-result.json` (ещё раз — `--force`). Если связь
  оборвалась посреди отправки, программа не повторяет вслепую: «неизвестно, вышел ли пост».
- У ботов нет отложенной публикации. Расписание — workflow «video-studio: Telegram по расписанию»:
  очередь — ролики по плану (релизы с `08a-….mp4`) по порядку кодов, по одному свежему релизу на
  код; код с `telegram-published.json` хоть в одном релизе больше не отправляется.
- `npm run telegram-check` — проверить бота и узнать id канала.

---

## Провайдеры и лицензии

| Что | Провайдер | Цена | Лицензия и условия |
|---|---|---|---|
| Сценарий | Gemini (AI Studio) | бесплатно в пределах квоты | Условия Google AI Studio; бесплатный тариф доступен не во всех странах |
| | Groq, OpenRouter `:free` | бесплатно, лимиты в минуту и сутки | Условия сервисов |
| | Ollama (локально) | бесплатно | Gemma и др. — лицензии моделей |
| | Claude | ≈ $0.08–0.20 за сценарий Shorts на Opus 5.5 (Sonnet 5.5 — вдвое дешевле) | Платно по факту использования |
| Голос | Edge TTS | бесплатно | Неофициальный API Microsoft |
| | Piper (через sherpa-onnx) | бесплатно, офлайн | sherpa-onnx — Apache-2.0; датасеты голосов — см. таблицу выше |
| | Gemini TTS | бесплатно ≈ 10 запросов в сутки на модель (шорт = 1 запрос) | Условия Google |
| | ElevenLabs | бесплатно 10 000 кредитов в месяц | Бесплатно — только некоммерчески и с атрибуцией |
| | Qwen3-TTS (через `openai`) | бесплатно на своём GPU | Apache-2.0, клонирование голоса |
| | Fish Speech | бесплатно на своём GPU | Некоммерческая лицензия |
| Визуал | Pexels, Pixabay | бесплатно | Можно в коммерческих роликах, атрибуция не обязательна (мы её добавляем в описание) |
| | Wikimedia Commons, Openverse | бесплатно, без ключа | Только PD, CC0, CC BY, CC BY-SA; автор, лицензия и ссылка — в описании ролика |
| | Cloudflare Workers AI (FLUX) | бесплатная суточная квота | Условия Cloudflare и модели |
| | Судья Claude (`VISUALS_JUDGE=claude`, по желанию) | ≈ $0.01–0.02 за Shorts на `claude-haiku-4-5` | Платно по факту использования; по умолчанию выключен |
| Рендер | Remotion 4 | бесплатно | См. ниже |

**Remotion** бесплатен для частных лиц, компаний до 3 сотрудников включительно и некоммерческих
организаций, в том числе для коммерческих роликов. Компаниям побольше нужна Company License
([remotion.pro/license](https://www.remotion.pro/license)). В Remotion 5.0 условия немного
поменяются (например, подрядчики будут учитываться в размере команды).

**Музыка** — `music/README.md`. Коротко: безопаснее всего сгенерированный эмбиент (по умолчанию,
без Content ID) и Фонотека YouTube. Треки CC BY требуют атрибуции: опишите её в json-файле рядом
с треком, и она сама попадёт в описание. Коммерческие песни не используйте никогда.

---

## Устройство проекта

```
src/types.ts              общий контракт: сценарий, props композиции, layoutScenes()
src/pipeline/contracts.ts контракты модулей и список всех переменных окружения
src/pipeline/script/      сценарий через LLM + проверка JSON
src/pipeline/voice/       6 провайдеров озвучки, тайминги слов
src/pipeline/visuals/     Pexels, Pixabay, Wikimedia, Openverse, Cloudflare; проверка «по теме» (relevance.ts)
src/pipeline/audio/       музыка (библиотека или генерация) и звук перехода
src/pipeline/props.ts     сборка props композиции
src/pipeline/render.ts    бандл Remotion → MP4 + обложка
src/pipeline/youtube.ts   загрузка на YouTube (resumable, publishAt)
src/pipeline/channel.ts   channel.json → умолчания конвейера, слоты расписания (DST-безопасно)
src/pipeline/instagram.ts Reels через Graph API (resumable на rupload), подпись instagram.txt
src/pipeline/telegram.ts  канал Telegram через Bot API (sendVideo, пережатие до 50 МБ)
src/pipeline/cover.ts     обложка Reels cover.jpg (кадр композиции Video)
src/remotion/             композиция «Video» и обложка «Thumbnail»
src/cli/                  make, script, upload, youtube-auth, instagram-token, telegram-check, brand
docs/                     инструкции для человека: YouTube Studio, Instagram, Telegram
src/dev/                  dev-скрипты (кадры, предпросмотр, тесты модулей)
assets/                   шрифты (OFL), копируются в каждый рендер
examples/demo-ru.json     пример сценария
scripts/                  черновики сценариев (коммитятся)
out/                      результаты (в git не попадают)
```

---

## Если что-то не так

| Симптом | Что делать |
|---|---|
| `Не удалось подготовить браузер для рендера` | Нет доступа к remotion.media или storage.googleapis.com. Повторите позже или укажите свой Chrome: `REMOTION_BROWSER_EXECUTABLE=C:\Program Files\Google\Chrome\Application\chrome.exe` и `REMOTION_CHROME_MODE=chrome-for-testing` |
| Linux: `error while loading shared libraries: libnss3.so` | Поставьте библиотеки из шага «Системные библиотеки» в workflow (`sudo apt-get install libnss3 libgbm1 …`) |
| `Edge TTS: нет соединения…` | Сервис недоступен из вашей сети: ролик переозвучится через Piper автоматически. Помогает `EDGE_PROXY` или `--voice gemini` |
| Piper: ошибка распаковки на Windows | Нужен встроенный `tar` (Windows 10 и новее). Иначе распакуйте архив модели вручную в `models/` (путь будет в сообщении) |
| `Нет ни одной доступной LLM` | Задайте `GEMINI_API_KEY` в `.env` (локально) или в секретах (GitHub) |
| Gemini: 429 / квота | Бесплатная квота на сегодня кончилась — подождите, добавьте `GROQ_API_KEY`/`OPENROUTER_API_KEY` или используйте `--script` |
| «квота Gemini закончилась — ролик соберётся при повторе» | Голос Gemini на сегодня кончился, а запасной выключен (`TTS_FALLBACK=none`, автопилот): панель перезапустит сборку, вручную — Re-run на следующий день. Озвученное раньше возьмётся из кэша |
| Пересборка дала ту же оговорку в озвучке | Сцены взяты из кэша (в логе «из кэша»): тот же текст — тот же дубль. Новый: `TTS_CACHE=0 npm run make -- …`, в GitHub — переменная репозитория `TTS_CACHE` = `0` на одну пересборку (потом удалите) |
| `Сценарий … не прошёл проверку` | В сообщении — список проблем с номерами сцен. Сверьтесь с `examples/demo-ru.json` |
| Кадры не по теме, в описании только Wikimedia, в логе «Pexels пропущен» | Не заданы `PEXELS_API_KEY` / `PIXABAY_API_KEY` — заведите бесплатные ключи ([docs/visuals.md](docs/visuals.md)). В логе шага «Визуал» видно название каждого взятого файла |
| Рендер очень медленный или ПК зависает | `RENDER_CONCURRENCY=1`, `VISUALS_PREFER=image`, закройте браузер; или рендерите в GitHub Actions |
| В логе `Detected differing memory amounts` | Предупреждение Remotion в Docker и облачных контейнерах, на результат не влияет |
| YouTube: `invalid_grant` | Токен отозван или истёк (приложение в статусе Testing). Переведите в In production и выполните `npm run youtube-auth` |
| YouTube: видео приватное, хотя просили public | Ограничение для непроверенных проектов Google — смените видимость в Studio |
| YouTube: `время публикации … уже прошло` | Слот наступил раньше, чем закончилась сборка: `npm run upload -- out/<имя> --schedule` возьмёт следующий |
| Instagram: `токен IG_ACCESS_TOKEN истёк` | `npm run instagram-token -- --exchange --page --save`, затем обновите секрет в GitHub ([docs/instagram-setup.md](docs/instagram-setup.md)) |
| Instagram: `нет нужного разрешения` / `IG_USER_ID` | Токен без галочек или в `IG_USER_ID` ник вместо числа — `npm run instagram-token` покажет, чего не хватает |
| Telegram: `канал не найден` / `бот не состоит в канале` | `npm run telegram-check` покажет верный id и права бота ([docs/telegram-setup.md](docs/telegram-setup.md)) |
| Странные ошибки путей на Windows | Перенесите проект в путь без пробелов и кириллицы (`C:\video\…`) |

Подробный лог любой ошибки: запустите с `DEBUG=1` (PowerShell: `$env:DEBUG=1`).
