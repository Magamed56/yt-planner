# Панель «Суть за минуту»

Веб-страница для телефона и компьютера, вход по паролю. Очередь из `content/plan.json` (60 тем),
этап каждого ролика — тема → сценарий → видео → в Studio → запланирован → вышел, напоминания,
перенос дня выхода, запуск сценариев, сборки и заполнения YouTube через GitHub Actions, автопилот.
На YouTube панель **не грузит** (загрузки через API от непроверенного проекта Google YouTube делает
приватными) — она напоминает и даёт скачать готовый файл.

## Экраны

- **Очередь** (`/`) — напоминания сверху (на сколько дней хватает расписания, что загрузить в Studio,
  что заполнить, упавшие запуски, недостающие ключи), фильтры по этапам, ролики по дням. Даты
  запланированных — с YouTube, остальных — ориентир: следующие свободные слоты по порядку плана.
  Карточка ролика (снизу на телефоне, справа на компьютере): что делать дальше, ⬇ видео из релиза,
  перенос (◀ день ▶ одним нажатием, занятый слот — обмен местами, «Отменить»), обложка и подпись
  для Reels, хук, угол и факты плана, текст сценария.
- **Запуски** (`/runs`) — «Сделать видео» / «Только сценарии» по темам плана; «YouTube: тексты
  и время» — «Проверить» (ничего не меняет, показывает разницу) → «Применить» для отмеченных;
  автопилот; журнал запусков; ключи.

## Установка на Vercel (один раз)

1. **PR с video-studio — в master.** Кнопки запуска работают только с workflow из ветки по умолчанию.
2. **Токен GitHub** — github.com/settings/personal-access-tokens/new → Fine-grained →
   Repository access: *Only select repositories* → `yt-planner` → Repository permissions:
   Actions — Read and write, Contents — Read and write, Variables — Read and write,
   Secrets — Read-only (панель видит только имена — каких ключей не хватает).
3. **Проект Vercel** — vercel.com → Add New → Project → Import `yt-planner` →
   Root Directory: `video-studio/panel` (Next.js определится сам; «Include files outside the root
   directory» оставьте включённым — панель берёт общий код из `video-studio/src`).
   Environment Variables — по `.env.example`: `PANEL_PASSWORD`, `SESSION_SECRET`, `GITHUB_TOKEN`,
   `GITHUB_REPO`, `GITHUB_BRANCH` (`master`), `YT_CLIENT_ID`, `YT_CLIENT_SECRET`,
   `YT_REFRESH_TOKEN` (как в `video-studio/.env`), `CRON_SECRET`. → Deploy.
4. Откройте ссылку и войдите паролем. На телефоне — «На экран „Домой“».
5. **Секреты GitHub Actions** (Settings → Secrets and variables → Actions): `GEMINI_API_KEY`
   (голос Charon — без него Actions озвучит Edge), `YT_CLIENT_ID`, `YT_CLIENT_SECRET`,
   `YT_REFRESH_TOKEN` (youtube-fill). Панель напоминает, чего не хватает.
6. **Google**: OAuth-приложение — «In production», иначе `YT_REFRESH_TOKEN` перестаёт работать
   через 7 дней (docs/youtube-setup.md).

Переменные Vercel меняются только с новым деплоем (Deployments → ⋯ → Redeploy).

## Как устроено

- Базы нет: план, сценарии, тексты для YouTube, релизы с видео и запуски — в GitHub, этапы и
  расписание — с YouTube. Ключи — только на сервере Vercel, в браузер не попадают.
- Поиск роликов на канале и слоты — общий код с `youtube-fill` (`src/pipeline/youtube-fill.ts`,
  `channel.ts`, `plan.ts`), поэтому панель и workflow всегда сходятся.
- Квота YouTube (10 000 единиц в сутки): обновление очереди ≈ 3 единицы, «Проверить» ≈ 100
  (поиск свежих загрузок), перенос ≈ 51, обмен местами ≈ 102.
- Перенос — `videos.update` части `status` со всеми текущими полями; меняется только `publishAt`.
  Переносить можно только приватный ролик с будущим временем выхода.
- Автопилот — Vercel Cron раз в день (`vercel.json`, 03:00 UTC = 06:00 МСК; на бесплатном тарифе
  чаще нельзя). Ролики, которые выходят в ближайшие N дней и ещё без видео, — запуск
  «video-studio: ролик» (`batch`, `plan` = коды, в релиз): сценарий пишет Claude, ролик собирается.
  Не больше 6 за раз; без `GEMINI_API_KEY` в секретах не запускает (голос был бы не тот).
  Настройки и отметка о последнем запуске — переменные репозитория `PANEL_AUTOPILOT`,
  `PANEL_AUTOPILOT_LAST`.
- Instagram ждёт токен EAA; пока в карточке ролика — видео, обложка и подпись для ручного Reels.

## Разработка

```bash
cd video-studio/panel
npm install
npm run dev                          # http://localhost:3100, переменные — в .env.local
npm run build                        # сборка и проверка типов
cd .. && npx tsx panel/scripts/state-test.ts   # логика очереди без сети
```
