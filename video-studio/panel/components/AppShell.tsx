"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { LiveRuns } from "@/app/api/runs/route";
import { clearPending, usePending } from "@/lib/pending";
import type { RunProgress } from "@/lib/progress";
import { logoutAction } from "@/app/actions";
import { plural } from "@/lib/stages";
import { useResumeRefresh } from "@/lib/use-resume-refresh";
import Freshness from "./Freshness";
import { useLangNav } from "./LangNav";
import { LiveRunsContext } from "./LiveRuns";

export type Section = "feed" | "calendar" | "runs";
type MainItem = Section | "board" | "stats";
// Пункты меню: лента и календарь на главной переключаются без перезагрузки, остальные — ссылки.
// «lang:en» — канал на другом языке (/lang/en), пункты приходят из LangNav.
export type NavItem = MainItem | `lang:${string}`;
// «План» убран: порядок выхода меняется прямо в календаре (одна очередь, без дублей).
const NAV: MainItem[] = ["feed", "calendar", "board", "runs", "stats"];

// Кольцо-секундомер из знака канала: заполнено на столько дней расписания из недели.
export function RunwayRing({ days, size = 52 }: { days: number | null; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const part = Math.min(1, Math.max(0, (days ?? 0) / 7));
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={days !== null && days < 2 ? "var(--warn)" : "var(--accent)"}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${c * part} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span>
        {days ?? "—"}
        <small>{days === null ? "" : plural(days, "день", "дня", "дней")}</small>
      </span>
    </span>
  );
}

const ICONS: Record<MainItem, React.ReactNode> = {
  feed: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  // «Доска» — полотно с зонами и стикером.
  board: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="5" rx="2" />
      <rect x="13" y="10" width="8" height="11" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
    </>
  ),
  runs: <path d="m6 4 14 8-14 8z" />,
  stats: <path d="M3 21h18M7 17v-5M12 17V5M17 17V9" />,
};
// Канал на другом языке — глобус.
const LANG_ICON = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </>
);
const LABEL: Record<MainItem, string> = { feed: "Лента", calendar: "Календарь", board: "Доска", runs: "Запуски", stats: "Статистика" };
const HREF: Record<MainItem, string> = { feed: "/", calendar: "/?view=calendar", board: "/board", runs: "/runs", stats: "/stats" };

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export default function AppShell({
  active,
  onSection,
  updated,
  generatedAt = null,
  activeRuns,
  activeIds,
  runwayDays,
  runwayLabel,
  loading = false,
  children,
}: {
  active: NavItem;
  onSection?: (s: Section) => void; // на главной лента и календарь переключаются без перезагрузки
  updated: string; // «14:05» — время данных (сервер)
  generatedAt?: string | null; // то же в ISO: «обновлено 3 мин назад» и автообновление
  activeRuns: number;
  activeIds?: number[]; // id идущих запусков на странице — с ними сравнивает опрос /api/runs
  runwayDays?: number | null; // нет (undefined) — без карточки запаса: страница не про русский канал
  runwayLabel?: string | null;
  loading?: boolean; // экран ещё грузится (loading.tsx): без цифр, которых пока нет
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());
  // Вернулись в приложение, а данным больше 5 минут — обновляем сами.
  useResumeRefresh(loading ? null : generatedAt, refresh, pending);

  // Пока в Actions что-то идёт (или только что нажали «запустить») — раз в 20 с спрашиваем
  // лёгкий /api/runs: этапы обновляются на месте, без квоты YouTube. Всю страницу обновляем,
  // только когда запуск появился или закончился. Ошибка — тихо реже, раз в минуту.
  const queued = usePending();
  const [live, setLive] = useState<Map<number, RunProgress>>(() => new Map());
  const baseSig = activeIds ? [...activeIds].sort((a, b) => a - b).join(",") : null;
  const waiting = queued.size > 0;
  useEffect(() => {
    if (loading || (!activeRuns && !waiting)) return;
    let seen = baseSig;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let delay = 20_000;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/runs", { cache: "no-store" });
          if (!res.ok) throw new Error(String(res.status));
          const j = (await res.json()) as LiveRuns;
          setLive(new Map(j.active.flatMap((r) => (r.progress ? [[r.id, r.progress] as const] : []))));
          clearPending(j.active.flatMap((r) => r.codes));
          if (seen === null) seen = j.signature;
          else if (j.signature !== seen) {
            seen = j.signature;
            startTransition(() => router.refresh());
          }
        } catch {
          delay = 60_000;
        }
      }
      if (!stopped) timer = setTimeout(tick, delay);
    };
    // Только что нажали — первый вопрос раньше: GitHub показывает запуск через 5–20 с.
    timer = setTimeout(tick, waiting ? 8_000 : 20_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [activeRuns, waiting, baseSig, loading, router]);

  // Основные разделы, затем каналы на других языках (обычно один — «English»).
  const langs = useLangNav();
  const items: { key: NavItem; href: string; label: string; icon: React.ReactNode }[] = [
    ...NAV.map((s) => ({ key: s, href: HREF[s], label: LABEL[s], icon: ICONS[s] })),
    ...langs.map((l) => ({ key: `lang:${l.code}` as const, href: `/lang/${l.code}`, label: l.label, icon: LANG_ICON })),
  ];
  const link = (it: (typeof items)[number]) => (
    <Link
      key={it.key}
      href={it.href}
      className={active === it.key ? "active" : ""}
      onClick={(e) => {
        const s = it.key;
        if (onSection && (s === "feed" || s === "calendar")) {
          e.preventDefault();
          onSection(s);
        }
      }}
    >
      <Icon>{it.icon}</Icon>
      <span className="nav-label">{it.label}</span>
    </Link>
  );
  const refreshIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );

  const bellIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="tag">СУТЬ</span>ЗА МИНУТУ
        </Link>
        <nav className="side-nav" aria-label="Разделы">
          {items.map(link)}
        </nav>
        <div className="side-foot">
          {runwayDays !== undefined && (
            <div className="runway-card">
              <RunwayRing days={runwayDays} />
              <div className="small muted">
                <b style={{ color: "var(--text)", display: "block" }}>запас расписания</b>
                {loading ? "загружаю…" : runwayLabel ? `без пропусков до ${runwayLabel}` : runwayDays === null ? "YouTube не ответил" : "ближайший слот пуст"}
              </div>
            </div>
          )}
          <div className="small muted">
            <Freshness at={generatedAt} label={updated} pending={pending} loading={loading} onRefresh={refresh} />
            {activeRuns ? ` · в работе: ${activeRuns}` : ""}
          </div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button className="btn small" onClick={refresh} disabled={pending}>
              {refreshIcon} {pending ? "Обновляю…" : "Обновить"}
            </button>
            <Link href="/settings" className="btn small ghost" aria-label="Уведомления на телефон">
              {bellIcon}
            </Link>
            <form action={logoutAction}>
              <button className="btn small ghost" type="submit">
                Выйти
              </button>
            </form>
          </div>
        </div>
      </aside>

      <header className="mobile-top">
        <div className="top-brand">
          <Link href="/" className="brand">
            <span className="tag">СУТЬ</span>ЗА МИНУТУ
          </Link>
          <Freshness at={generatedAt} label={updated} pending={pending} loading={loading} onRefresh={refresh} />
        </div>
        <div className="actions">
          {/* У панели со значка на iPhone нет адресной строки — настройки уведомлений только по ссылке. */}
          <Link href="/settings" className="btn icon" aria-label="Уведомления" title="Уведомления на телефон">
            {bellIcon}
          </Link>
          <button className="btn icon" onClick={refresh} disabled={pending} aria-label="Обновить" title={`обновлено ${updated}`}>
            {pending ? "…" : refreshIcon}
          </button>
        </div>
      </header>

      <div className="content">
        <LiveRunsContext.Provider value={live}>{children}</LiveRunsContext.Provider>
      </div>

      <nav className="tabbar" aria-label="Разделы">
        {items.map(link)}
      </nav>
    </div>
  );
}
