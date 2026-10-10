// «Скелет» экрана, пока сервер собирает данные из GitHub и YouTube (loading.tsx): меню и
// вкладки — сразу, на месте содержимого — серые блоки. Так переход между вкладками мгновенный.
import AppShell, { type NavItem } from "./AppShell";

type Kind = "feed" | "list" | "stats";

function Blocks({ kind }: { kind: Kind }) {
  if (kind === "feed") {
    return (
      <>
        <div className="sk sk-hero" />
        <div className="sk sk-bar" />
        <div className="sk-row">
          <div className="sk sk-chip" />
          <div className="sk sk-chip" />
          <div className="sk sk-chip" />
        </div>
        <div className="sk-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="sk sk-cover" />
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="sk sk-title" />
      {kind === "stats" && (
        <div className="sk-kpis">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="sk sk-kpi" />
          ))}
        </div>
      )}
      {Array.from({ length: kind === "stats" ? 3 : 4 }, (_, i) => (
        <div key={i} className="sk sk-card" />
      ))}
    </>
  );
}

export default function PageSkeleton({ active, kind }: { active: NavItem; kind: Kind }) {
  // Страница канала на другом языке — без карточки запаса расписания русского канала.
  const runway = !active.startsWith("lang:");
  return (
    <AppShell active={active} updated="" activeRuns={0} runwayDays={runway ? null : undefined} runwayLabel={null} loading>
      <main className={kind === "feed" ? "skeleton" : "page skeleton"} aria-busy="true" aria-label="Загружаю">
        <Blocks kind={kind} />
      </main>
    </AppShell>
  );
}
