# Аудит YouTube API — заявка (идея 53)

**Зачем.** Проект Google не проходил проверку, поэтому YouTube делает приватными все ролики,
загруженные через API. Из-за этого ролики грузятся руками в Studio. После аудита загрузка через API
работает как обычно, и автопилот сможет выкладывать ролики сам. Проверка идёт от нескольких дней до
нескольких недель.

## Что сделать до отправки

1. **Страницы политики и условий** уже есть в панели и открываются без пароля:
   - https://yt-planner-video-studio-green.vercel.app/privacy
   - https://yt-planner-video-studio-green.vercel.app/terms
2. **Google Branding** (https://console.cloud.google.com/auth/branding):
   - в «Application privacy policy link» поставить ссылку `/privacy`;
   - в «Application terms of service link» — ссылку `/terms`;
   - Save.
3. **Почта для вопросов о данных:** переменная `PANEL_CONTACT_EMAIL` в Vercel (Settings → Environment
   Variables), затем Redeploy. Без неё страницы предлагают связаться через канал на YouTube.
4. **Запись экрана на 2–3 минуты:**
   - вход в панель → очередь → карточка ролика;
   - «Найти новые загрузки» (показать, какие тексты и время встанут);
   - перенос дня выхода в календаре;
   - страницы `/privacy` и `/terms`.

   Загрузить на YouTube с доступом по ссылке, ссылку вставить в форму.
5. **Общий проект Google.** Проект `594586455322` общий с инструментом канала игры (bakery-escape).
   Аудит идёт на проект целиком, поэтому есть два пути:
   - в заявке описать оба клиента (один владелец, загрузка своих роликов на свои каналы);
   - сначала вынести «Суть» в отдельный проект (идея 96) и подать заявку на него.

**Форма:** https://support.google.com/youtube/contact/yt_api_form — заполняется на английском.
Ниже готовые ответы.

---

## Answers for the form (English)

**Request type.** Audit / compliance review to lift the private-only restriction on videos uploaded
with `videos.insert` from our unverified API project. No quota increase is needed — the default
10,000 units/day is enough.

**API project number.** 594586455322

**Organization / who we are.** An individual creator running the YouTube channel “Суть за минуту”
(https://www.youtube.com/channel/UCBMfWLydXjrPllxIkjgdbzw): short educational videos in Russian that explain one fact in
about a minute, two Shorts per day, each with sources listed in the description. All content is
produced by the channel owner with an automated pipeline: the owner approves topics and facts with
sources, the pipeline writes a script, synthesizes the voice-over (disclosed with
`containsSyntheticMedia: true`), assembles stock footage and motion graphics, and renders the video.
The API client exists only to publish and manage the owner’s own videos on the owner’s own channel.

**Target audience of the API client.** Only the channel owner (a single user). The client is not
offered to other users or creators.

**API clients.**
1. *Panel* — a private web app at https://yt-planner-video-studio-green.vercel.app (password
   protected; privacy policy https://yt-planner-video-studio-green.vercel.app/privacy, terms of use
   https://yt-planner-video-studio-green.vercel.app/terms). Shows the upload queue, release
   calendar and statistics; sets titles, descriptions, tags and publish times.
2. *video-studio* — the owner’s command-line pipeline and GitHub Actions workflow that renders the
   videos and (after this audit) uploads them privately with a scheduled `publishAt`.

**How we use YouTube API Services.**
- `channels.list` (mine=true; snippet, contentDetails, statistics) — the uploads playlist and
  channel statistics.
- `playlistItems.list` — list the channel’s own uploads.
- `videos.list` (snippet, status, contentDetails, fileDetails, statistics) — the queue and
  per-video statistics in the panel.
- `search.list` (forMine=true, type=video; rarely) — find fresh uploads that are not yet in the
  uploads playlist.
- `videos.update` (snippet, status) — set the title, description, tags, category, language and
  `publishAt` on the owner’s own videos; `containsSyntheticMedia` stays true.
- `videos.insert` (after the audit) — upload the owner’s rendered videos as private with
  `publishAt`.
- `commentThreads.list` / `commentThreads.insert` — one optional first comment by the channel
  under its own published video (a question and the sources), posted only after the owner reviews
  it in the panel; the list call makes sure the channel has not commented there yet.
- YouTube Analytics API `reports.query` (ids=channel==MINE, dimensions=video) — average view
  percentage and duration of the owner’s own videos, shown in the panel; not stored.
- Planned: `thumbnails.set` (long videos), `playlists.insert` / `playlistItems.insert` (topic
  playlists), `captions.insert` (translated subtitles).

**Authentication.** OAuth 2.0 with the channel owner’s own Google account (scopes `youtube`,
`youtube.upload`, `youtube.force-ssl`, `yt-analytics.readonly`). Only the owner authorizes the app; access can be revoked at
https://security.google.com/settings/security/permissions.

**Data storage.** No database. API data is requested on demand and not stored; statistics are shown
live and not persisted. The refresh token is kept in encrypted environment variables (Vercel) and
encrypted GitHub Actions secrets. Nothing is shared with third parties; no ads.

**Compliance.** The privacy policy and terms pages contain the links and disclosures required by
the YouTube API Services Developer Policies (section III.A): a link to the YouTube Terms of Service,
a link to the Google Privacy Policy, a description of the data accessed and used, the revocation
link and a contact. Every video is uploaded with `containsSyntheticMedia: true` because the
voice-over is synthesized.

**Demo access.** The panel is single-user and password protected. We can share a temporary password
on request; a screencast of all API features is attached.
