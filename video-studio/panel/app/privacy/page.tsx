// Политика конфиденциальности — открытая страница (без входа). Пункты — по требованиям YouTube API
// Services Developer Policies III.A.2: что за сервис, какие данные YouTube берём и зачем, где
// храним, ссылки на политику Google и на отзыв доступа, контакт. Английская часть — для проверки
// Google (аудит YouTube API).
import Link from "next/link";
import { LEGAL_UPDATED, legalInfo } from "@/lib/legal";
import s from "../legal.module.css";

export const metadata = { title: "Политика конфиденциальности / Privacy Policy" };

const GOOGLE_PRIVACY = "http://www.google.com/policies/privacy";
const REVOKE = "https://security.google.com/settings/security/permissions";
const YT_TERMS = "https://www.youtube.com/t/terms";
const TIKTOK_PRIVACY = "https://www.tiktok.com/legal/privacy-policy";

function Ext({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {href}
    </a>
  );
}

export default function PrivacyPage() {
  const { name, youtube, email } = legalInfo();
  const contactRu = email ? <a href={`mailto:${email}`}>{email}</a> : youtube ? <>через канал на YouTube: <Ext href={youtube} /></> : "через канал на YouTube";
  const contactEn = email ? <a href={`mailto:${email}`}>{email}</a> : youtube ? <>via the YouTube channel: <Ext href={youtube} /></> : "via the YouTube channel";
  return (
    <main className={s.page}>
      <nav className={s.nav}>
        <Link href="/login">Вход в панель</Link>
        <Link href="/terms">Условия использования / Terms of Use</Link>
      </nav>

      <h1>Политика конфиденциальности</h1>
      <p className={s.updated}>Обновлено: {LEGAL_UPDATED.ru}</p>

      <h2>Что это за сервис</h2>
      <p>
        Панель «{name}» — закрытый инструмент владельца одноимённого YouTube-канала для работы с собственными роликами: очередь, календарь
        выхода, тексты и время публикации, статистика. Войти может только владелец канала по паролю. Сервис использует API-сервисы YouTube
        (YouTube API Services).
      </p>

      <h2>Какие данные мы получаем</h2>
      <p>
        Владелец канала входит через Google (OAuth) и даёт сервису доступ к своему каналу. Сервис получает: список роликов канала, их
        названия, описания, теги, статус и время публикации, имена загруженных файлов, обложки и статистику (просмотры, лайки,
        комментарии, подписчики). Для сравнения сервис может читать открытую информацию других каналов (названия и статистику роликов).
        Данные других пользователей YouTube сервис не собирает.
      </p>

      <h2>TikTok</h2>
      <p>
        По желанию владелец подключает свой аккаунт TikTok (TikTok Login Kit). Сервис получает: имя и аватар профиля, имя пользователя,
        число подписчиков, лайков и роликов, список публичных роликов с подписями, обложками и статистикой (просмотры, лайки, комментарии,
        репосты) — только чтобы показать владельцу статистику. Ничего не публикует и не меняет. Ключ доступа хранится в зашифрованном виде;
        отключить доступ можно кнопкой «Отключить» в панели или в настройках TikTok (Безопасность → Управление приложениями). Действует и{" "}
        <Ext href={TIKTOK_PRIVACY} />.
      </p>

      <h2>Как мы используем данные</h2>
      <p>
        Только чтобы показать владельцу состояние его роликов и по его команде изменить его же ролики: название, описание, теги, время
        публикации, плейлисты и субтитры. Данные не продаются, не используются для рекламы и не передаются третьим лицам.
      </p>

      <h2>Хранение</h2>
      <p>
        У сервиса нет базы данных: данные YouTube запрашиваются в момент открытия страницы и не сохраняются. Ключ доступа к каналу
        хранится в зашифрованных переменных окружения на сервере. Тексты сценариев и описаний — собственный контент канала — хранятся в
        закрытом репозитории GitHub.
      </p>

      <h2>Сторонние сервисы</h2>
      <p>
        Хостинг — Vercel; код, сценарии и видеофайлы — GitHub; доступ к YouTube — Google. Для написания сценариев могут использоваться
        Anthropic Claude и Google Gemini: им передаются только темы и тексты роликов, но не данные аккаунтов YouTube. Рекламы и сторонних
        трекеров на сайте нет.
      </p>

      <h2>Cookies</h2>
      <p>Сервис ставит одну cookie сессии, чтобы владелец оставался в панели после входа. Других cookies нет.</p>

      <h2>Политика Google и условия YouTube</h2>
      <p>
        Данные, полученные от Google, обрабатываются также по Политике конфиденциальности Google: <Ext href={GOOGLE_PRIVACY} />. Условия
        использования YouTube: <Ext href={YT_TERMS} />.
      </p>

      <h2>Как отозвать доступ</h2>
      <p>
        В любой момент на странице безопасности аккаунта Google: <Ext href={REVOKE} />. После этого сервис сразу теряет доступ к каналу.
      </p>

      <h2>Контакты</h2>
      <p>Вопросы о конфиденциальности: {contactRu}.</p>

      <section className={s.lang} lang="en">
        <h1>Privacy Policy</h1>
        <p className={s.updated}>Last updated: {LEGAL_UPDATED.en}</p>

        <h2>About this service</h2>
        <p>
          The “{name}” panel is a private tool of the owner of the YouTube channel “{name}” for managing the channel’s own videos: upload
          queue, release calendar, titles, descriptions and publish times, statistics. Only the channel owner can sign in (password
          protected). This service uses YouTube API Services.
        </p>

        <h2>Information we access</h2>
        <p>
          The channel owner signs in with Google (OAuth) and grants access to their own channel. The service accesses: the list of the
          channel’s videos, their titles, descriptions, tags, privacy status and publish time, uploaded file names, thumbnails and
          statistics (views, likes, comments, subscribers). To compare performance it may read public information of other channels
          (video titles and statistics). The service does not collect data about other YouTube users.
        </p>

        <h2>TikTok</h2>
        <p>
          Optionally the owner connects their own TikTok account (TikTok Login Kit). The service accesses the profile name, avatar and
          username, follower, like and video counts, and the list of public videos with captions, covers and statistics (views, likes,
          comments, shares) — only to show the owner their statistics. Nothing is posted or changed. The access token is stored encrypted;
          access can be revoked with “Disconnect” in the panel or in TikTok settings (Security → Manage app permissions). The TikTok Privacy
          Policy also applies: <Ext href={TIKTOK_PRIVACY} />.
        </p>

        <h2>How we use it</h2>
        <p>
          Only to show the owner the state of their videos and, on the owner’s command, to update the owner’s own videos: title,
          description, tags, publish time, playlists and captions. The data is not sold, not used for advertising and not shared with
          third parties.
        </p>

        <h2>Storage</h2>
        <p>
          The service has no database: YouTube data is requested when a page is opened and is not stored. The channel access token is
          kept in encrypted server environment variables. Video scripts and descriptions (the channel’s own content) are kept in a
          private GitHub repository.
        </p>

        <h2>Third parties</h2>
        <p>
          Hosting: Vercel; code, scripts and video files: GitHub; YouTube access: Google. Script writing may use Anthropic Claude and
          Google Gemini, which receive only video topics and texts, never YouTube account data. There are no ads or third-party trackers.
        </p>

        <h2>Cookies</h2>
        <p>The service sets a single session cookie to keep the owner signed in. No other cookies are used.</p>

        <h2>Google Privacy Policy and YouTube Terms</h2>
        <p>
          Data received from Google is also handled under the Google Privacy Policy: <Ext href={GOOGLE_PRIVACY} />. YouTube Terms of
          Service: <Ext href={YT_TERMS} />.
        </p>

        <h2>Revoking access</h2>
        <p>
          You can revoke the service’s access at any time on the Google security settings page: <Ext href={REVOKE} />.
        </p>

        <h2>Contact</h2>
        <p>Privacy questions: {contactEn}.</p>
      </section>
    </main>
  );
}
