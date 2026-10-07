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

## Где что

- `src/types.ts` — общий контракт: `VideoScript`, `VideoProps`, `layoutScenes()`,
  `buildTimelineCaptions()` (единственное место расчёта тайминга, его же использует композиция).
- `src/pipeline/contracts.ts` — интерфейсы модулей и **полный список переменных окружения**
  (их же документирует `.env.example`). Меняй контракты только аддитивно.
- `src/pipeline/{script,voice,visuals,audio}/` — модули конвейера; `props.ts` (сборка props),
  `render.ts` (bundle → renderMedia/renderStill), `youtube.ts` (resumable-загрузка),
  `srt.ts`, `meta.ts` (описание/теги), `slug.ts`.
- `src/remotion/` — композиции `Video` и `Thumbnail` (`Root.tsx`); ассеты — `staticFile()`
  относительно publicDir запуска (`out/<slug>/public`).
- `src/cli/` — `make.ts` (всё одной командой), `script.ts` (черновик), `upload.ts`, `youtube-auth.ts`.
- `src/dev/` — dev-скрипты: `stills.ts`, `preview.ts`, `voice-test.ts`, `script-test.ts`, `visuals-test.ts`.
- `.github/workflows/video-studio.yml` (в корне репозитория) — draft/render в GitHub Actions.
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
npx tsx src/dev/script-test.ts && npx tsx src/dev/visuals-test.ts   # тесты без сети
```

В песочнице без доступа к remotion.media браузер задаётся явно:
`REMOTION_BROWSER_EXECUTABLE=<путь к headless_shell> REMOTION_CHROME_MODE=headless-shell`.
Без этих переменных `render.ts` вызывает `ensureBrowser()` (скачивание в `node_modules/.remotion`).

## Проверка результата

После изменений в композиции или конвейере: `npm run make -- --demo`, затем ffprobe
(1080×1920, h264 + aac, длительность ≈ `props.durationInFrames / 30`), `ffmpeg -af volumedetect`
(звук не тихий) и несколько кадров через `ffmpeg -vf select=eq(n\,N)` — посмотреть глазами.
