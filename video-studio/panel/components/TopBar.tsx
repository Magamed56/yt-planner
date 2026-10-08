"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { logoutAction } from "@/app/actions";

export default function TopBar({ channel, updated, activeRuns }: { channel: string; updated: string; activeRuns: number }) {
  const router = useRouter();
  const path = usePathname();
  const [pending, startTransition] = useTransition();

  // Пока в Actions что-то идёт — обновляемся сами раз в 90 с, и только открытая вкладка:
  // каждое обновление — запросы к GitHub и ~3 единицы квоты YouTube.
  useEffect(() => {
    if (!activeRuns) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    }, 90_000);
    return () => clearInterval(timer);
  }, [activeRuns, router]);

  return (
    <header className="top">
      <div className="top-title">
        <strong>{channel}</strong>
        <span className="muted small">
          обновлено {updated}
          {activeRuns ? ` · ⚙ в работе запусков: ${activeRuns}` : ""}
        </span>
      </div>
      <nav className="top-nav">
        <Link href="/" className={path === "/" ? "active" : ""}>
          Очередь
        </Link>
        <Link href="/runs" className={path === "/runs" ? "active" : ""}>
          Запуски
        </Link>
        <button className="btn ghost" onClick={() => startTransition(() => router.refresh())} disabled={pending} aria-label="Обновить" title="Обновить">
          {pending ? "…" : "⟳"}
        </button>
        <form action={logoutAction}>
          <button className="btn ghost" type="submit">
            Выйти
          </button>
        </form>
      </nav>
    </header>
  );
}
