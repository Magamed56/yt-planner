# video-studio — заметки для Claude

Отдельный от Next.js-приложения (родительская папка) проект: тема → сценарий (LLM) → озвучка (TTS)
→ визуал → моушен-графика в Remotion 4.0.534 → MP4. Пользователь русскоязычный, ролики на русском,
основной формат — Shorts 1080×1920 (есть landscape 1920×1080). Документация для человека — README.md.

## Правила

- **Только бесплатные инструменты по умолчанию.** Платное (Claude, ElevenLabs) — лишь опцией через
  переменные окружения. Не предлагай платные сервисы по умолчанию, даже если так советуют
  Remotion-скиллы: `remotion-markup/voiceover.md` зовёт ElevenLabs, а `remotion-captions` —
  `@remotion/whisper-webgpu` (нужна видеокарта). Здесь голос и тайминги слов дают
  `src/pipeline/voice` (Edge/Piper/Gemini…), субтитры строятся из них.
- **Не ставь и не удаляй npm-пакеты без явной просьбы.** Все версии Remotion строго одинаковые (4.0.534).
- **Windows-совместимость:** только `path.join`/`path.resolve`, без bash-специфики в коде, без
  симлинков, без обязательного системного ffmpeg (Remotion везёт свой). Пути в props — с «/».
- TypeScript strict, ESM (`"type": "module"`), запуск — `npx tsx`. Комментарии в коде — по-русски,
  коротко и про «почему». Сообщения пользователю — по-русски, с подсказкой, что делать.
- Сетевой код — с таймаутами и понятной деградацией (визуал → без визуала, Edge → Piper).
- Не используй `@remotion/google-fonts`: без доступа к хосту шрифтов рендер висит до таймаута.
  Шрифты лежат в `assets/fonts` и подключаются через webpack.
- **Канал — `channel.json`** («Суть за минуту»): имя, голос, тема, хэштеги, призывы, ссылки,
  дисклеймер, слоты 12:00/19:00 Europe/Moscow. С диска читает только `src/pipeline/channel-file.ts`
  (`loadChannel`), разбирает `channel.ts` (`channelFromJson`, `applyChannelDefaults`, слоты — без
  файловой системы: его импортирует веб-панель); переменные окружения сильнее файла. Название
  канала не хардкодь — бери из `channel.json`.
- **Публикация — только официальные API.** YouTube: Data API v3, `status.publishAt` только с
  `privacyStatus: private`, `containsSyntheticMedia` всегда. Instagram: «Instagram API with Facebook
  Login for Business» (`graph.facebook.com` + resumable на `rupload.facebook.com`) — только он
  грузит локальный файл без публичного URL; у API нет отложенной публикации (расписание — workflow
  с очередью в релизах). TikTok: только чтение статистики (Login Kit + Display API, панель,
  `docs/tiktok-setup.md`) — публиковать через API TikTok не даёт инструментам для своего аккаунта.
  Никаких неофициальных библиотек и логинов по паролю.

## Где что

- `src/types.ts` — общий контракт: `VideoScript`, `VideoProps`, `layoutScenes()`,
  `buildTimelineCaptions()` (единственное место расчёта тайминга, его же использует композиция).
- `src/pipeline/contracts.ts` — интерфейсы модулей и **полный список переменных окружения**
  (их же документирует `.env.example`). Меняй контракты только аддитивно.
- `src/pipeline/{script,voice,visuals,audio}/` — модули конвейера (озвучка: общий кэш между запусками —
  `voice/shared-cache.ts`, `.cache/voice`; запасной голос и поле `voice` в qc.json — `voice/fallback.ts`); `props.ts` (сборка props),
  `render.ts` (bundle → renderMedia/renderStill), `youtube.ts` (resumable-загрузка, publishAt),
  `srt.ts`, `meta.ts` (описание/теги, подвал канала), `slug.ts`, `channel.ts` (channel.json, слоты
  расписания через Intl — DST-безопасно), `instagram.ts` (Reels: контейнер → rupload → статус →
  media_publish; подпись `instagram.txt`), `cover.ts` (обложка Reels `cover.jpg` — renderStill
  композиции Video в конце хука, тот же кадр → `thumb_offset`).
- `src/pipeline/plan.ts` — `content/plan.json` (60 тем: хук, угол, факты с источниками): `parsePlan`,
  `planNotes` (пожелания LLM), `scriptCode` (код из `scripts/sut-08a-….json`); `npm run script --
  --plan 08a,08b` пишет сценарии по плану. `google-api.ts` — access token и разбор ошибок API без
  googleapis. `src/cli/videos-list.ts` — после рендера в релиз дописывает тексты ролика в
  `content/videos.json` (youtube-fill читает его вместе с `week1-videos.json`).
- **Общий код с панелью** (`youtube-fill.ts`, `channel.ts`, `plan.ts`, `google-api.ts`, `types.ts`):
  только встроенные модули Node и относительные импорты — без npm-пакетов и без чтения файлов
  (иначе Next.js потащит в функцию Vercel всю папку).
- `panel/` — веб-панель на Vercel (Next.js 16, вход по паролю): очередь, перенос `publishAt`, запуск
  workflow, автопилот (Vercel Cron). Свои зависимости в `panel/package.json`; устройство и установка —
  `panel/README.md`.
- `src/remotion/` — композиции `Video` и `Thumbnail` (`Root.tsx`); ассеты — `staticFile()`
  относительно publicDir запуска (`out/<slug>/public`).
- `src/cli/` — `make.ts` (всё одной командой), `script.ts` (черновик), `upload.ts` (`--to youtube,instagram`,
  `--schedule`), `publish-options.ts` (общие флаги `--upload`/`--schedule*`), `youtube-auth.ts`,
  `instagram-token.ts` (проверка/продление токена, IG_USER_ID), `brand.ts`, `youtube-fill.ts` (ролики,
  загруженные в Studio руками: найти по коду «01a» в имени файла и поставить тексты/publishAt через
  videos.update; логика — `src/pipeline/youtube-fill.ts`, данные — `content/week1-videos.json`).
- `src/dev/` — dev-скрипты: `stills.ts`, `preview.ts`, `voice-test.ts`, `script-test.ts`, `visuals-test.ts`,
  `publish-test.ts` (канал, слоты, описание, publishAt, Instagram на подменённом fetch).
- `docs/` — инструкции для человека: `youtube-setup.md` (Studio, расписание), `instagram-setup.md`,
  `tiktok-setup.md`, `visuals.md` (кадры по теме: ключи стоков, правила `visuals/relevance.ts`,
  судья Claude); `improvements.md` — разбор, что улучшить дальше (по приоритету).
- `.github/workflows/video-studio.yml` (в корне репозитория) — draft / render / batch в GitHub Actions
  (batch: ролик i → слот i через `--schedule-slot i --schedule-start <старт>`, релиз на ролик);
  `video-studio-instagram.yml` — публикует самый старый релиз с `instagram.json` без
  `instagram-published.json` (расписание закомментировано); `video-studio-youtube-fill.yml` —
  `youtube-fill` кнопкой из GitHub; `video-studio-titles.yml` — `npm run title-ideas -- <коды>`
  (новые названия для слабого старта → `content/title-ideas.json`, общий модуль
  `src/pipeline/title-ideas.ts`, LLM — `script/title-gen.ts`; применяет панель);
  `video-studio-ci.yml` — проверки на PR и пуш в `claude/**` (см. «Команды»).
- `.claude/skills/` — официальные скиллы Remotion (skills@1.7.1, версия 4.0.534, `skills-lock.json`).
  Обновить: `DISABLE_TELEMETRY=1 npx -y skills@1.7.1 update -p -y`.

## Команды

```bash
npx tsc --noEmit -p .                       # типы (должно быть 0 ошибок)
npm run make -- --demo                      # e2e: демо-ролик → out/<slug>/video.mp4
TTS_PROVIDER=piper VISUALS=none npm run make -- --demo   # офлайн (без сети)
npm run make -- --script scripts/x.json --no-render      # всё, кроме рендера
npm run script -- --topic "тема"            # черновик сценария → scripts/<slug>.json
npx tsx src/dev/stills.ts                   # кадры композиции → out/dev/stills
npx tsx src/dev/script-test.ts && npx tsx src/dev/visuals-test.ts && npx tsx src/dev/publish-test.ts   # тесты без сети
npx tsx src/dev/voice-test.ts               # озвучка без сети: кэш, запасной голос (--live — настоящий синтез)
npx tsx panel/scripts/state-test.ts         # очередь панели без сети; сборка панели: cd panel && npm run build
npm run upload -- out/<slug> --to youtube,instagram --schedule      # публикация готового ролика
```

CI — `.github/workflows/video-studio-ci.yml` (в корне репозитория): на каждый PR и пуш в `claude/**`
с изменениями в video-studio — `tsc`, все `src/dev/*-test.ts` и `panel/scripts/*-test.ts`
(кроме `voice-test.ts`), затем `tsc` и `next build` панели как на Vercel — без переменных и без
`node_modules` video-studio (npm-импорт в общем коде упадёт здесь, а не при деплое; локальная сборка
его не ловит). Новый `*-test.ts` подхватывается сам, поэтому обязан обходиться без сети и ключей;
сетевой проверке — другое имя или исключение в workflow.

В песочнице без доступа к remotion.media браузер задаётся явно:
`REMOTION_BROWSER_EXECUTABLE=<путь к headless_shell> REMOTION_CHROME_MODE=headless-shell`.
Без этих переменных `render.ts` вызывает `ensureBrowser()` (скачивание в `node_modules/.remotion`).

## Проверка результата

После изменений в композиции или конвейере: `npm run make -- --demo`, затем ffprobe
(1080×1920, h264 + aac, длительность ≈ `props.durationInFrames / 30`), `ffmpeg -af volumedetect`
(звук не тихий) и несколько кадров через `ffmpeg -vf select=eq(n\,N)` — посмотреть глазами.
