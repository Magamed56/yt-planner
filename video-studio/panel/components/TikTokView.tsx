"use client";
// Экран «TikTok»: подключение аккаунта, цифры и ролики, как выкладывать и что с заработком.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TikTokStats } from "@/lib/tiktok-data";
import AppShell from "./AppShell";
import Thumb from "./Thumb";
import ViewsChart, { type ChartBar } from "./ViewsChart";

type Shell = { updated: string; activeRuns: number; runwayDays: number | null; runwayLabel: string | null };

export interface TikTokPageData {
  missing: string[]; // не заданы в Vercel
  redirectUri: string; // прописать в портале TikTok
  docsUrl: string;
  status: "setup" | "disconnected" | "connected";
  error: string | null;
  connectedLabel: string | null;
  stats: TikTokStats | null;
}

const SECTIONS = [
  { id: "account", label: "Аккаунт" },
  { id: "videos", label: "Ролики" },
  { id: "post", label: "Как выкладывать" },
  { id: "money", label: "Заработок" },
];
const LIMIT = 12;
const STUDIO = "https://www.tiktok.com/tiktokstudio/upload";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b>{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function bars(stats: TikTokStats): ChartBar[] {
  return [...stats.videos]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-20)
    .map((v) => ({
      key: v.id,
      label: `${v.code ?? "—"} · ${v.dateLabel}`,
      title: v.title || "без подписи",
      value: v.views,
      valueLabel: v.viewsLabel,
      sub: `${v.perDayLabel} в сутки · ❤ ${v.likesLabel} · 💬 ${v.commentsLabel} · ↗ ${v.sharesLabel}`,
    }));
}

export default function TikTokView({ data, shell }: { data: TikTokPageData; shell: Shell }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const s = data.stats;
  const shown = s ? (showAll ? s.videos : s.videos.slice(0, LIMIT)) : [];
  const top = Math.max(1, ...(s?.videos.map((v) => v.views) ?? [1]));

  async function copyUri() {
    try {
      await navigator.clipboard.writeText(data.redirectUri);
      setNote({ ok: true, text: "Адрес скопирован." });
    } catch {
      setNote({ ok: false, text: "Скопируйте адрес вручную." });
    }
  }

  async function disconnect() {
    if (!window.confirm("Отключить TikTok? Доступ будет отозван, статистика пропадёт до нового подключения.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tiktok/disconnect", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      setNote({ ok: res.ok, text: j.message ?? `Панель ответила ${res.status}.` });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell active="stats" updated={shell.updated} activeRuns={shell.activeRuns} runwayDays={shell.runwayDays} runwayLabel={shell.runwayLabel}>
      <main className="page stats-page">
        <div className="page-head titled">
          <div>
            <h1>TikTok</h1>
            <span className="small muted">{s ? `${s.user.displayName}${s.user.username ? ` · @${s.user.username}` : ""}` : "подключение и статистика"}</span>
          </div>
          <div className="actions">
            <Link href="/stats" className="btn small">
              ← YouTube
            </Link>
          </div>
        </div>
        <nav className="section-nav" aria-label="Разделы TikTok">
          {SECTIONS.map((x) => (
            <a key={x.id} href={`#${x.id}`} className="chip">
              {x.label}
            </a>
          ))}
        </nav>
        {data.error && <p className="notice error">{data.error}</p>}

        <div className="stats-grid">
          <section className="card wide" id="account">
            {data.status === "setup" && (
              <>
                <h2>Подключить TikTok — один раз</h2>
                <p className="muted small">Нужно своё приложение TikTok for Developers (бесплатно, режим Sandbox — без проверки TikTok). Подробно — по ссылке ниже.</p>
                <ol className="steps">
                  <li>
                    developers.tiktok.com → войти тем же TikTok → Manage apps → Connect an app → <b>Sandbox</b>.
                  </li>
                  <li>
                    Добавить продукт <b>Login Kit</b> (Web) и права: user.info.basic, user.info.profile, user.info.stats, video.list.
                  </li>
                  <li>
                    Redirect URI — ровно этот адрес:
                    <span className="copy-line">
                      <code>{data.redirectUri}</code>
                      <button className="btn small" onClick={copyUri}>
                        Копировать
                      </button>
                    </span>
                  </li>
                  <li>Target users — добавить свой аккаунт TikTok.</li>
                  <li>
                    Vercel → Settings → Environment Variables: <code>TIKTOK_CLIENT_KEY</code> и <code>TIKTOK_CLIENT_SECRET</code> (Client key и Client secret
                    из портала) → Redeploy. Сейчас не хватает: {data.missing.join(", ")}.
                  </li>
                </ol>
                <div className="btn-row">
                  <a className="btn" href={data.docsUrl} target="_blank" rel="noreferrer">
                    Подробная инструкция ↗
                  </a>
                </div>
              </>
            )}
            {data.status === "disconnected" && (
              <>
                <h2>TikTok не подключён</h2>
                <p className="muted">Откроется TikTok — войдите своим аккаунтом и нажмите «Разрешить». Панель только читает статистику: ничего не публикует и не меняет.</p>
                <div className="btn-row">
                  <a className="btn primary" href="/api/tiktok/start">
                    Подключить TikTok
                  </a>
                </div>
                <p className="muted small">
                  Если TikTok пишет про redirect_uri — в портале должен стоять адрес <code>{data.redirectUri}</code>.
                </p>
              </>
            )}
            {data.status === "connected" && s && (
              <>
                <div className="tt-profile">
                  <Thumb src={s.user.avatar} code="TT" className="avatar" />
                  <div>
                    <b>{s.user.displayName}</b>
                    <span className="muted small">
                      {s.user.username ? `@${s.user.username} · ` : ""}подключён {data.connectedLabel}
                    </span>
                  </div>
                  <button className="btn small ghost" disabled={busy} onClick={disconnect}>
                    Отключить
                  </button>
                </div>
                <div className="kpis">
                  <Kpi label="Подписчики" value={s.followersLabel} />
                  <Kpi label="Лайки профиля" value={s.likesLabel} />
                  <Kpi label="Ролики" value={s.videosLabel} />
                  <Kpi label="Просмотры за 30 дней" value={s.views30Label} hint="у роликов, вышедших за 30 дней" />
                  <Kpi label="В среднем на ролик" value={s.avgViewsLabel} hint="просмотров" />
                  <Kpi label="Вовлечённость" value={s.engagementLabel} hint="лайки, комментарии и репосты от просмотров" />
                </div>
                <ViewsChart bars={bars(s)} caption="Просмотры роликов по дате выхода — нажмите на столбик" />
              </>
            )}
            {note && <p className={`small ${note.ok ? "ok-text" : "error-text"}`}>{note.text}</p>}
          </section>

          {s && (
            <section className="card wide" id="videos">
              <h2>Ролики в TikTok</h2>
              {s.videos.length === 0 ? (
                <p className="muted">Публичных роликов пока нет.</p>
              ) : (
                <>
                  <ol className="vstats">
                    {shown.map((v, i) => (
                      <li key={v.id} className="vstat">
                        <a className="vstat-main" href={v.url ?? "#"} target="_blank" rel="noreferrer">
                          <span className="vstat-rank">{i + 1}</span>
                          <Thumb src={v.cover} code={v.code ?? "TT"} />
                          <span className="vstat-title">
                            <b>{v.title || "без подписи"}</b>
                            <span className="muted small">{[v.code, v.dateLabel, v.durationSec ? `${v.durationSec} с` : null].filter(Boolean).join(" · ")}</span>
                            <span className="vstat-share" aria-hidden="true">
                              <i style={{ width: `${(v.views / top) * 100}%` }} />
                            </span>
                          </span>
                        </a>
                        <span className="vstat-nums">
                          <span>
                            <b>{v.viewsLabel}</b>
                            <small>просмотры</small>
                          </span>
                          <span>
                            <b>{v.likesLabel}</b>
                            <small>лайки</small>
                          </span>
                          <span>
                            <b>{v.commentsLabel}</b>
                            <small>коммент.</small>
                          </span>
                          <span>
                            <b>{v.sharesLabel}</b>
                            <small>репосты</small>
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  {s.videos.length > LIMIT && (
                    <div className="btn-row">
                      <button className="btn small" onClick={() => setShowAll(!showAll)}>
                        {showAll ? "Свернуть" : `Показать все ${s.videos.length}`}
                      </button>
                    </div>
                  )}
                  <p className="muted small">Код темы ставится, если в подписи есть название ролика из плана. TikTok отдаёт только публичные ролики.</p>
                </>
              )}
            </section>
          )}

          <section className="card" id="post">
            <h2>Как выкладывать</h2>
            <p>
              <b>Автопубликации через API не будет:</b> TikTok пускает к публикации только проверенные приложения «для многих пользователей» и прямо отказывает
              инструментам для своего аккаунта. Без проверки ролик через API выходит только «Только я», а сам аккаунт должен быть закрытым.
            </p>
            <h3 className="tag-h">Быстрее всего — раз в неделю с компьютера</h3>
            <ol className="steps">
              <li>Лента → «Выбрать» → ролики недели → «⬇ Скачать»: видео и обложки 9:16, в именах файлов — коды роликов.</li>
              <li>TikTok Studio → «Загрузить» → выбрать сразу несколько видео → у каждого «Запланировать»: до 10 дней вперёд, в 12:00 и 19:00, как на YouTube.</li>
              <li>Подпись — в карточке ролика «📋 Подпись» (вставляется как есть). Обложку выбрать из файла «…-cover.jpg».</li>
              <li>Включить «Контент, созданный ИИ»: голос синтезирован, TikTok требует такую пометку.</li>
            </ol>
            <p className="muted small">С телефона: «📱 Сохранить в Фото» в карточке ролика → TikTok «+» → видео из галереи → вставить подпись.</p>
            <div className="btn-row">
              <a className="btn" href={STUDIO} target="_blank" rel="noreferrer">
                TikTok Studio ↗
              </a>
            </div>
          </section>

          <section className="card" id="money">
            <h2>Заработок</h2>
            <p>
              Официальная монетизация TikTok — <b>Creator Rewards</b>: 18+, личный аккаунт, 10 000 подписчиков, 100 000 просмотров за 30 дней, оригинальные
              ролики <b>дольше 1 минуты</b>.
            </p>
            {s?.rewards.map((g) => (
              <div className={`meter ${g.done ? "done" : "normal"}`} key={g.label}>
                <div className="meter-top">
                  <span>{g.label}</span>
                  <span className="meter-val">
                    {g.done && "✓ "}
                    {g.haveLabel} <span className="muted">из {g.needLabel}</span>
                  </span>
                </div>
                <div className="meter-track" role="progressbar" aria-label={g.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.percent)}>
                  <span style={{ width: `${g.percent}%` }} className={g.percent > 0 ? "some" : ""} />
                </div>
              </div>
            ))}
            <ul className="facts">
              <li>Программа работает только в США, Великобритании, Германии, Франции, Японии, Южной Корее, Бразилии и Мексике — Кыргызстана, Казахстана и России в списке нет.</li>
              <li>В Кыргызстане TikTok заблокирован с 2024 года (открывается через VPN), в России с 2022 года не показываются новые ролики — зрители оттуда их почти не увидят.</li>
              <li>Ролики «Сути» — около минуты: для Creator Rewards нужны длиннее 60 секунд (формат «Разбор»).</li>
              <li>Что реально сейчас: TikTok как витрина — ссылка на YouTube в профиле (монетизация там), прямые интеграции с брендами при живой аудитории.</li>
            </ul>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
