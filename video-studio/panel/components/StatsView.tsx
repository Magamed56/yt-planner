"use client";
import Link from "next/link";
import { useState } from "react";
import { plural } from "@/lib/stages";
import type { StatsExtras } from "@/app/stats/load";
import type { Goal, StatsData, VideoStat } from "@/lib/stats";
import AppShell from "./AppShell";
import RetentionCard from "./RetentionCard";
import r from "./retention.module.css";
import { PlaylistsCard, TimingCard, WeakStartCard } from "./StatsTools";
import Thumb from "./Thumb";
import ViewsChart, { type ChartBar } from "./ViewsChart";

type Shell = { updated: string; activeRuns: number; runwayDays: number | null; runwayLabel: string | null };
type SortKey = "views" | "perDay" | "retention" | "likes" | "comments" | "date";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "views", label: "Просмотры" },
  { key: "perDay", label: "В сутки" },
  { key: "retention", label: "Досмотр" },
  { key: "likes", label: "Лайки" },
  { key: "comments", label: "Комментарии" },
  { key: "date", label: "Новые" },
];
const LIMIT = 12;
const NO_USAGE = "нет данных — появятся после следующей сборки";

const sortValue = (v: VideoStat, k: SortKey) =>
  k === "views"
    ? v.views
    : k === "perDay"
      ? v.perDay
      : k === "retention"
        ? (v.retention?.percent ?? -1)
        : k === "likes"
          ? (v.likes ?? -1)
          : k === "comments"
            ? (v.comments ?? -1)
            : Date.parse(v.publishedAt);

// Доля без Intl: одинаково на сервере и в браузере. Маленькие — с десятыми, чтобы 0,1 % не стал нулём.
const pct = (p: number) => `${p > 0 && p < 10 ? (Math.floor(p * 10) / 10).toString().replace(".", ",") : Math.floor(p)} %`;

// Полоска «есть из нужного»: цвет — состояние (обычная, ближе к лимиту, лимит, цель достигнута),
// значение всегда подписано текстом.
function Meter({ label, value, of, percent, tone = "normal" }: { label: string; value: string; of: string; percent: number; tone?: "normal" | "warn" | "over" | "done" }) {
  return (
    <div className={`meter ${tone}`}>
      <div className="meter-top">
        <span>{label}</span>
        <span className="meter-val">
          {tone === "done" && "✓ "}
          {value} <span className="muted">из {of}</span>
          <span className="meter-pct">{pct(percent)}</span>
        </span>
      </div>
      <div className="meter-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <span style={{ width: `${percent}%` }} className={percent > 0 ? "some" : ""} />
      </div>
    </div>
  );
}

// Разделы страницы — быстрые переходы сверху (на телефоне страница длинная).
const SECTIONS = [
  { id: "overview", label: "Обзор" },
  { id: "videos", label: "Ролики" },
  { id: "weak", label: "Слабый старт" },
  { id: "money", label: "Монетизация" },
  { id: "pillars", label: "Рубрики" },
  { id: "tags", label: "Хэштеги" },
  { id: "timing", label: "Время выхода" },
  { id: "playlists", label: "Плейлисты" },
  { id: "costs", label: "Расходы" },
];

// Последние 20 вышедших — по дате выхода, для графика.
function chartBars(videos: VideoStat[]): ChartBar[] {
  return [...videos]
    .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt))
    .slice(-20)
    .map((v) => ({
      key: v.videoId,
      label: `${v.code ?? "—"} · ${v.dateLabel}`,
      title: v.title,
      value: v.views,
      valueLabel: v.viewsLabel,
      sub: `${v.perDayLabel} в сутки${v.retention ? ` · досмотр ${v.retention.percentLabel}` : ""} · 👍 ${v.likesLabel} · 💬 ${v.commentsLabel}`,
    }));
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi" title={hint}>
      <span>{label}</span>
      <b>{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

const goalMeter = (g: Goal) => <Meter key={g.label} label={g.label} value={g.haveLabel} of={g.needLabel} percent={g.percent} tone={g.done ? "done" : "normal"} />;
const usageTone = (percent: number) => (percent >= 100 ? "over" : percent >= 80 ? "warn" : "normal");

export default function StatsView({ stats, shell, extras }: { stats: StatsData; shell: Shell; extras: StatsExtras }) {
  const [sort, setSort] = useState<SortKey>("views");
  const [showAll, setShowAll] = useState(false);
  const sorted = [...stats.videos].sort((a, b) => sortValue(b, sort) - sortValue(a, sort) || b.views - a.views);
  const shown = showAll ? sorted : sorted.slice(0, LIMIT);
  const topViews = Math.max(1, ...stats.videos.map((v) => v.views));
  const { monetization: money, hashtags: tags, usage, actions, channel, retention } = stats;
  // Сортировка «Досмотр» — только когда YouTube Analytics ответил.
  const sorts = retention ? SORTS : SORTS.filter((s) => s.key !== "retention");

  return (
    <AppShell active="stats" updated={shell.updated} activeRuns={shell.activeRuns} runwayDays={shell.runwayDays} runwayLabel={shell.runwayLabel}>
      <main className="page stats-page">
        <div className="page-head titled">
          <div>
            <h1>Статистика</h1>
            <span className="small muted">YouTube · обновлено {shell.updated}</span>
          </div>
          <div className="actions">
            <Link href="/tiktok" className="btn small">
              TikTok →
            </Link>
            <Link href="/competitors" className="btn small">
              Похожие каналы →
            </Link>
          </div>
        </div>
        <nav className="section-nav" aria-label="Разделы статистики">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="chip">
              {s.label}
            </a>
          ))}
        </nav>
        {stats.youtubeError && <p className="notice error">YouTube недоступен: {stats.youtubeError}. Цифры роликов и канала появятся, когда он ответит.</p>}

        <div className="stats-grid">
          <section className="card wide overview" id="overview" aria-label="Канал">
            <div className={`kpis${retention ? ` ${r.kpis8}` : ""}`}>
              <Kpi label="Подписчики" value={channel?.subscribersLabel ?? "—"} />
              <Kpi label="Просмотры канала" value={channel?.viewsLabel ?? "—"} />
              <Kpi label="Вышло" value={channel?.publishedLabel ?? "—"} />
              <Kpi label="В среднем на ролик" value={channel?.avgViewsLabel ?? "—"} hint="просмотров" />
              <Kpi label="Вовлечённость" value={channel?.engagementLabel ?? "—"} hint="лайки и комментарии от просмотров" />
              <Kpi label="Лайки" value={channel?.likesLabel ?? "—"} hint="у вышедших роликов" />
              {retention && (
                <>
                  <Kpi label="Досмотр" value={retention.percentLabel} hint="средний % ролика, с весом по просмотрам" />
                  <Kpi label="Средний просмотр" value={retention.durationLabel} hint="мин:сек на один просмотр" />
                </>
              )}
            </div>
            <ViewsChart bars={chartBars(stats.videos)} caption="Просмотры роликов по дате выхода — нажмите на столбик" />
          </section>

          {stats.retentionProblem && <RetentionCard problem={stats.retentionProblem} />}

          <section className="card wide" id="videos">
            <h2>Ролики</h2>
            {stats.videos.length === 0 ? (
              <p className="muted">{stats.youtubeError ? "Нет связи с YouTube." : "Вышедших роликов пока нет."}</p>
            ) : (
              <>
                <div className="chips" role="group" aria-label="Сортировка">
                  {sorts.map((s) => (
                    <button key={s.key} className={`chip${sort === s.key ? " active" : ""}`} onClick={() => setSort(s.key)}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <ol className="vstats">
                  {shown.map((v, i) => (
                    <li key={v.videoId} className={`vstat${v.mark ? ` ${v.mark}` : ""}`}>
                      <a className="vstat-main" href={`https://youtube.com/shorts/${v.videoId}`} target="_blank" rel="noreferrer">
                        <span className="vstat-rank">{i + 1}</span>
                        <Thumb src={v.thumbnailUrl} code={v.code ?? "—"} />
                        <span className="vstat-title">
                          <b>{v.title}</b>
                          <span className="muted small">
                            {[v.code, v.pillarTitle, v.dateLabel].filter(Boolean).join(" · ")}
                            {v.fresh ? " · меньше суток" : ""}
                          </span>
                          {v.mark === "best" && <span className="vmark best">▲ лучший</span>}
                          {v.mark === "worst" && <span className="vmark worst">▼ слабее всех</span>}
                          {v.retention?.weak && <span className={`vmark ${r.weak}`}>▼ слабый досмотр</span>}
                          <span className="vstat-share" aria-hidden="true">
                            <i style={{ width: `${(v.views / topViews) * 100}%` }} />
                          </span>
                        </span>
                      </a>
                      <span className={`vstat-nums${retention ? ` ${r.nums6}` : ""}`}>
                        <span>
                          <b>{v.viewsLabel}</b>
                          <small>просмотры</small>
                        </span>
                        <span>
                          <b>{v.perDayLabel}</b>
                          <small>в сутки</small>
                        </span>
                        {retention && (
                          <>
                            <span>
                              <b className={v.retention?.weak ? r.low : undefined}>{v.retention?.percentLabel ?? "—"}</b>
                              <small>досмотр</small>
                            </span>
                            <span>
                              <b>{v.retention?.durationLabel ?? "—"}</b>
                              <small>ср. просмотр</small>
                            </span>
                          </>
                        )}
                        <span>
                          <b>{v.likesLabel}</b>
                          <small>лайки</small>
                        </span>
                        <span>
                          <b>{v.commentsLabel}</b>
                          <small>коммент.</small>
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                {sorted.length > LIMIT && (
                  <div className="btn-row">
                    <button className="btn small" onClick={() => setShowAll(!showAll)}>
                      {showAll ? "Свернуть" : `Показать все ${sorted.length}`}
                    </button>
                  </div>
                )}
                <p className="muted small">
                  В сутки — просмотры, делённые на сутки с выхода. Лучший и слабее всех — по ним, среди роликов старше суток
                  {stats.fresh ? ` (${stats.fresh} ${plural(stats.fresh, "ролик вышел", "ролика вышли", "роликов вышли")} меньше суток назад — попадут в сравнения завтра)` : ""}.
                </p>
                {retention && (
                  <p className="muted small">
                    Досмотр — какую часть ролика в среднем смотрят (у Shorts бывает больше 100 % из-за повторов), средний просмотр — сколько времени. Из YouTube
                    Analytics, с задержкой 1–3 дня — у свежих роликов «—». ▼ Слабый досмотр — меньше 50 % у Shorts (30 % у длинных) при 20 и больше просмотрах
                    {retention.weak ? `: таких ${retention.weak}` : ""}.
                  </p>
                )}
              </>
            )}
          </section>

          <WeakStartCard extras={extras} />

          <section className="card" id="money">
            <h2>Монетизация</h2>
            {money.tiers.map((t) => (
              <div className="tier" key={t.id}>
                <div className="tier-head">
                  <b>{t.title}</b>
                  <span className="muted small">{t.perks}</span>
                  {t.done && <span className="done-badge">✓ условия выполнены</span>}
                </div>
                {t.goals.map(goalMeter)}
              </div>
            ))}
            <p className="muted small">
              {money.engaged
                ? "≈ — сумма засчитанных просмотров (YouTube Analytics) Shorts, вышедших за 90 дней; у самых свежих — обычные просмотры. "
                : "≈ — сумма просмотров Shorts, вышедших за 90 дней (Data API не отдаёт просмотры за период). YouTube для порога считает только засчитанные просмотры — "}
              точная цифра в Studio → «Монетизация».
            </p>
          </section>

          <section className="card" id="pillars">
            <h2>Рубрики</h2>
            <p className="muted small">Средние просмотры в сутки на ролик — какие темы заходят лучше.</p>
            <ol className="ranks">
              {stats.pillars.map((p) => (
                <li key={p.id} className={p.perDay === null ? "none" : ""}>
                  <span className="rank-name">
                    {p.title}
                    <small>{p.videos ? `${p.videos} ${plural(p.videos, "ролик", "ролика", "роликов")}` : "нет роликов старше суток"}</small>
                  </span>
                  <span className="rank-bar" aria-hidden="true">
                    <i style={{ width: `${p.share * 100}%` }} />
                  </span>
                  <span className="rank-val">{p.perDayLabel}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="card" id="tags">
            <h2>Хэштеги</h2>
            <p className="muted small">Средние просмотры роликов с хэштегом из описания — только хэштеги хотя бы из 2 роликов.</p>
            {tags.best.length === 0 ? (
              <p className="muted small">Пока не с чем сравнивать: нужны разные хэштеги, которые повторились хотя бы в 2 роликах старше суток.</p>
            ) : (
              <div className="tag-cols">
                <div>
                  <h3 className="tag-h">▲ Лучше всего</h3>
                  <ul className="tags">
                    {tags.best.map((t) => (
                      <li key={t.tag}>
                        <span>{t.tag}</span>
                        <b>{t.avgLabel}</b>
                        <small>{t.videos} рол.</small>
                      </li>
                    ))}
                  </ul>
                </div>
                {tags.worst.length > 0 && (
                  <div>
                    <h3 className="tag-h">▼ Хуже всего</h3>
                    <ul className="tags">
                      {tags.worst.map((t) => (
                        <li key={t.tag}>
                          <span>{t.tag}</span>
                          <b>{t.avgLabel}</b>
                          <small>{t.videos} рол.</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {tags.everywhere.length > 0 && <p className="muted small">Во всех роликах, не сравниваем: {tags.everywhere.join(" ")}.</p>}
          </section>
          <TimingCard extras={extras} />
          <PlaylistsCard extras={extras} />

          <section className="card" id="costs">
            <h2>Расходы</h2>
            <div className="cost">
              <h3>GitHub Actions</h3>
              {actions ? (
                <>
                  <Meter label={`Минуты за ${actions.monthLabel}`} value={`≈ ${actions.minutesLabel}`} of={`${actions.limitLabel} мин`} percent={actions.percent} tone={usageTone(actions.percent)} />
                  <p className="muted small">
                    {actions.runs} {plural(actions.runs, "запуск", "запуска", "запусков")} этого репозитория; бесплатно — 2 000 минут в месяц на приватные репозитории
                    аккаунта.
                  </p>
                </>
              ) : (
                <p className="error-text small">{stats.actionsError ?? "нет данных"}</p>
              )}
            </div>
            <div className="cost">
              <h3>Claude — сценарии</h3>
              {usage ? (
                <p>
                  <b className="cost-sum">{usage.claude.monthUsdLabel}</b> за месяц · сегодня {usage.claude.todayUsdLabel}
                  <span className="muted small">
                    {" "}
                    · {usage.claude.monthRequests} {plural(usage.claude.monthRequests, "запрос", "запроса", "запросов")}
                    {usage.claude.unpriced ? `, без цены: ${usage.claude.unpriced}` : ""}
                  </span>
                </p>
              ) : (
                <p className="muted small">{NO_USAGE}</p>
              )}
            </div>
            <div className="cost">
              <h3>Gemini — озвучка</h3>
              {usage ? (
                <>
                  <Meter label="Озвучки сегодня" value={String(usage.gemini.today)} of={`≈ ${usage.gemini.limit} бесплатных`} percent={usage.gemini.percent} tone={usageTone(usage.gemini.percent)} />
                  <p className="muted small">Сутки Google — с полуночи по Калифорнии: лимит обнулится в {usage.gemini.resetLabel}. Сверх лимита ролик озвучит Edge.</p>
                </>
              ) : (
                <p className="muted small">{NO_USAGE}</p>
              )}
            </div>
            {usage && usage.bad > 0 && (
              <p className="muted small">
                В content/usage.jsonl пропущено битых строк: {usage.bad}.
              </p>
            )}
            {stats.usageError && <p className="error-text small">content/usage.jsonl: {stats.usageError}</p>}
          </section>

        </div>
      </main>
    </AppShell>
  );
}
