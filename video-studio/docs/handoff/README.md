# Передача работы: 3 Shorts + «Разбор» в день (13.10.2026)

Ветка: `claude/daily-razbor-3-shorts` (PR ещё не создан). Облачная сессия:
https://claude.ai/code/session_012aVSwGhxayJ9brrDRFytMg — её можно перенести в терминал:
`claude --teleport session_012aVSwGhxayJ9brrDRFytMg` (в клоне репозитория, чистое дерево, тот же аккаунт claude.ai).

## Что уже сделано в ветке
- `channel.json`: Shorts в 12:00, 16:00, 19:00 МСК; «Разбор» каждый день в 20:00 МСК. Обоснование
  времени — в заметках `schedule.note` и `longSlots.note`. Тесты переведены на своё расписание
  (`panel/lib/fixture-channel.ts`, `LEGACY` в `src/dev/long-test.ts`); все `*-test.ts`, tsc и tsc панели — зелёные.
- `.github/workflows/video-studio.yml`: без переменных VISUALS и VISUALS_JUDGE включены генерация картинки
  для сцен без кадра по теме (Cloudflare FLUX при ключе) и судья Claude для кадров.
- Сценарии Shorts 25a–30b (написал Claude Opus в CI), названия 25a, 25b, 27b, 28b, 29b улучшены.
- L01: убран дословный повтор сцен s22–s25 (в старом видео фрагмент звучит дважды), обложка — лимон и
  «12-й → 62-й». **Старое видео L01 не публиковать**: нужен новый файл из релиза.
- `src/dev/script-check.mts` — офлайн-проверка сценария теми же правилами, что и CI.
- Брифы: `razbor-brief.md` (как писать «Разбор»), `topic-brief.md` (как собирать тему с фактами).

## Что не доделано
1. Сценарии «Разборов» L02–L06 (темы и факты — в `content/long-plan.json`). Если в `scripts/` нет
   `razbor-L02-…json` и т. д. — написать по `razbor-brief.md`, проверить `script-check.mts`, в
   long-plan.json поставить теме `"status": "script-ready"` и `"script": "scripts/razbor-L0X-….json"`.
2. Новые темы «Разборов» L07–L16 (выбраны, факты не собраны): L07 тюльпаномания (money), L08 почему
   летает самолёт и миф о «равном времени» (why), L09 Стэнфордский тюремный эксперимент (mind),
   L10 Финеас Гейдж (body), L11 «Аполлон-13» (space), L12 кратер Чиксулуб и вымирание динозавров (nature),
   L13 дневник Мерера и пирамида Хеопса (history), L14 Антикитерский механизм (tech), L15 дилемма
   заключённого и турнир Аксельрода (money), L16 парадокс Монти Холла (why). Если нет файлов
   `docs/handoff/topics-L07-L08.json` и др. — собрать по `topic-brief.md` и дописать в long-plan.json.
3. Рендер: workflow «video-studio: ролик», mode = batch, plan = коды, upload = release,
   voice_fallback = none, ref = эта ветка. «Разбор» ≈ 85 минут и ≈ 3 запроса Gemini TTS; в один запуск —
   не больше 3 «Разборов» (лимит задания 350 минут). Квота Gemini: 10 запросов в сутки на модель и ключ
   (2 ключа × 3 модели), сброс около 07:00 UTC. Сначала «Разборы» (основная модель), потом Shorts.
4. Владельцу: лимит расходов GitHub Actions (Settings → Billing): при «Разборе» каждый день минут больше,
   чем 2000 бесплатных; ключ Cloudflare (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN) — качественная
   генерация картинок; ключ PEXELS_API_KEY — больше живого видео; влить PR в master, чтобы панель и
   автопилот взяли новое расписание и тексты.

## Промпт для локальной сессии
Скопируйте целиком:

```
Продолжаем работу из облачной сессии. Репозиторий yt-planner, папка video-studio, ветка
claude/daily-razbor-3-shorts (сделай git fetch и checkout, затем git pull). Сначала прочитай
video-studio/CLAUDE.md, video-studio/docs/handoff/README.md, razbor-brief.md и topic-brief.md там же.

Задача владельца: с 13.10.2026 выпускаем 3 Shorts в день (12:00, 16:00, 19:00 МСК) и «Разбор»
каждый день в 20:00 МСК. Темы выбирать очень тщательно, сценарии писать идеально (деньги на
сценарии не экономим), названия и обложки — тоже тщательно; картинки генерировать, где нет кадра
по теме; рендерить, тратя весь суточный лимит Gemini TTS.

Сделай по порядку:
1. Сценарии «Разборов» L02–L06, которых ещё нет в scripts/: напиши по razbor-brief.md, каждый
   факт проверь веб-поиском, прогони npx tsx src/dev/script-check.mts, отметь в
   content/long-plan.json (status script-ready, script). Название — до 70 символов, с поисковым
   запросом, не повторяет хук; обложка — onScreen хука ≤ 48 символов, иконка хука и первая
   stat-сцена с самым сильным числом.
2. Темы L07–L16 из README (факты 10–12 с источниками на тему, по topic-brief.md) — в long-plan.json.
   Затем сценарии L07–L10 тем же способом.
3. Проверки: npx tsc --noEmit -p . ; все src/dev/*-test.ts и panel/scripts/*-test.ts (кроме
   voice-test). Закоммить и запушь в ветку.
4. Запусти рендер через GitHub Actions (workflow video-studio.yml, ref = эта ветка): mode batch,
   upload release, voice_fallback none; не больше 3 «Разборов» в одном запуске; «Разборы» раньше
   Shorts. Проверь, что L01 и Shorts 25a–30b уже собраны в релизы (их запустили из облака).
5. Предложи создать PR в master и скажи, что нужно сделать мне руками (минуты Actions, ключи
   Cloudflare и Pexels, перезалить L01).
Пиши мне по-русски, коротко.
```
