// Условия использования — открытая страница (без входа). YouTube API Services Developer Policies
// III.A.1: ссылка на Условия YouTube и согласие с ними при использовании сервиса.
import Link from "next/link";
import { LEGAL_UPDATED, legalInfo } from "@/lib/legal";
import s from "../legal.module.css";

export const metadata = { title: "Условия использования / Terms of Use" };

const YT_TERMS = "https://www.youtube.com/t/terms";
const GOOGLE_PRIVACY = "http://www.google.com/policies/privacy";

function Ext({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {href}
    </a>
  );
}

export default function TermsPage() {
  const { name, youtube, email } = legalInfo();
  const contact = email ? <a href={`mailto:${email}`}>{email}</a> : youtube ? <Ext href={youtube} /> : null;
  return (
    <main className={s.page}>
      <nav className={s.nav}>
        <Link href="/login">Вход в панель</Link>
        <Link href="/privacy">Политика конфиденциальности / Privacy Policy</Link>
      </nav>

      <h1>Условия использования</h1>
      <p className={s.updated}>Обновлено: {LEGAL_UPDATED.ru}</p>
      <p>
        Панель «{name}» — закрытый инструмент владельца одноимённого YouTube-канала. Доступ — только у владельца, по паролю.
      </p>
      <p>
        Сервис использует API-сервисы YouTube (YouTube API Services). Пользуясь сервисом, вы соглашаетесь с Условиями использования
        YouTube: <Ext href={YT_TERMS} />.
      </p>
      <p>
        Как сервис обращается с данными — в <Link href="/privacy">Политике конфиденциальности</Link>; также действует Политика
        конфиденциальности Google: <Ext href={GOOGLE_PRIVACY} />.
      </p>
      <p>Сервис предоставляется «как есть», без гарантий бесперебойной работы.</p>
      {contact && <p>Связь с владельцем: {contact}.</p>}

      <section className={s.lang} lang="en">
        <h1>Terms of Use</h1>
        <p className={s.updated}>Last updated: {LEGAL_UPDATED.en}</p>
        <p>The “{name}” panel is a private tool of the owner of the YouTube channel of the same name. Only the owner has access (password protected).</p>
        <p>
          This service uses YouTube API Services. By using this service, you agree to be bound by the YouTube Terms of Service:{" "}
          <Ext href={YT_TERMS} />.
        </p>
        <p>
          How the service handles data is described in the <Link href="/privacy">Privacy Policy</Link>; the Google Privacy Policy also
          applies: <Ext href={GOOGLE_PRIVACY} />.
        </p>
        <p>The service is provided “as is”, without warranty of uninterrupted operation.</p>
        {contact && <p>Contact the owner: {contact}.</p>}
      </section>
    </main>
  );
}
