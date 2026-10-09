"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { logoutAction } from "@/app/actions";
import { plural } from "@/lib/stages";

export type Section = "feed" | "calendar" | "runs";
// Пункты меню: лента и календарь на главной переключаются без перезагрузки, остальные — ссылки.
type NavItem = Section | "plan" | "stats";
const NAV: NavItem[] = ["feed", "calendar", "plan", "runs", "stats"];

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

const ICONS: Record<NavItem, React.ReactNode> = {
  feed: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  plan: <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />,
  runs: <path d="m6 4 14 8-14 8z" />,
  stats: <path d="M3 21h18M7 17v-5M12 17V5M17 17V9" />,
};
const LABEL: Record<NavItem, string> = { feed: "Лента", calendar: "Календарь", plan: "План", runs: "Запуски", stats: "Статистика" };
const HREF: Record<NavItem, string> = { feed: "/", calendar: "/?view=calendar", plan: "/plan", runs: "/runs", stats: "/stats" };

function Icon({ section }: { section: NavItem }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[section]}
    </svg>
  );
}

export default function AppShell({
  active,
  onSection,
  updated,
  activeRuns,
  runwayDays,
  runwayLabel,
  children,
}: {
  active: NavItem;
  onSection?: (s: Section) => void; // на главной лента и календарь переключаются без перезагрузки
  updated: string;
  activeRuns: number;
  runwayDays: number | null;
  runwayLabel: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());

  // Пока в Actions что-то идёт — обновляемся сами раз в 90 с, только открытая вкладка
  // (каждое обновление — запросы к GitHub и ~3 единицы квоты YouTube).
  useEffect(() => {
    if (!activeRuns) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    }, 90_000);
    return () => clearInterval(timer);
  }, [activeRuns, router]);

  const link = (s: NavItem, className?: string, withIcon = true) => (
    <Link
      key={s}
      href={HREF[s]}
      className={`${className ?? ""}${active === s ? " active" : ""}`}
      onClick={(e) => {
        if (onSection && (s === "feed" || s === "calendar")) {
          e.preventDefault();
          onSection(s);
        }
      }}
    >
      {withIcon && <Icon section={s} />}
      {LABEL[s]}
    </Link>
  );
  const refreshIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="tag">СУТЬ</span>ЗА МИНУТУ
        </Link>
        <nav className="side-nav" aria-label="Разделы">
          {NAV.map((s) => link(s))}
        </nav>
        <div className="side-foot">
          <div className="runway-card">
            <RunwayRing days={runwayDays} />
            <div className="small muted">
              <b style={{ color: "var(--text)", display: "block" }}>запас расписания</b>
              {runwayLabel ? `до ${runwayLabel}` : "нет запланированных"}
            </div>
          </div>
          <div className="small muted">
            обновлено {updated}
            {activeRuns ? ` · в работе: ${activeRuns}` : ""}
          </div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button className="btn small" onClick={refresh} disabled={pending}>
              {refreshIcon} {pending ? "Обновляю…" : "Обновить"}
            </button>
            <form action={logoutAction}>
              <button className="btn small ghost" type="submit">
                Выйти
              </button>
            </form>
          </div>
        </div>
      </aside>

      <header className="mobile-top">
        <Link href="/" className="brand">
          <span className="tag">СУТЬ</span>ЗА МИНУТУ
        </Link>
        <div className="actions">
          <button className="btn icon" onClick={refresh} disabled={pending} aria-label="Обновить" title={`обновлено ${updated}`}>
            {pending ? "…" : refreshIcon}
          </button>
        </div>
      </header>

      <div className="content">{children}</div>

      <nav className="tabbar" aria-label="Разделы">
        {NAV.map((s) => link(s))}
      </nav>
    </div>
  );
}
