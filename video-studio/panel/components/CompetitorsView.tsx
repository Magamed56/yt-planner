"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCompetitorAction, removeCompetitorAction, type CompetitorsResult } from "@/app/competitors/actions";
import AppShell from "@/components/AppShell";
import type { CompetitorReport, CompetitorVideo } from "@/lib/competitors";
import { plural } from "@/lib/stages";
import s from "./competitors.module.css";

const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const count = (v: number | null) => (v === null ? "скрыто" : compact.format(v));

function ageLabel(publishedAt: string): string {
  const days = Math.floor((Date.now() - Date.parse(publishedAt)) / 86_400_000);
  return days < 1 ? "сегодня" : `${days} ${plural(days, "день", "дня", "дней")} назад`;
}

function VideoLine({ v }: { v: CompetitorVideo }) {
  return (
    <li>
      <a href={v.short ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer">
        {v.title}
      </a>
      <div className="small muted">
        {compact.format(v.views)} просм. · {compact.format(v.perDay)} в сутки · {ageLabel(v.publishedAt)}
        {v.comments !== null ? ` · ${compact.format(v.comments)} комм.` : ""}
      </div>
    </li>
  );
}

export default function CompetitorsView({
  shell,
  refs,
  reports,
}: {
  shell: { updated: string; generatedAt?: string; activeRuns: number; runwayDays: number | null; runwayLabel: string | null };
  refs: string[];
  reports: CompetitorReport[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [input, setInput] = useState("");
  const [result, setResult] = useState<CompetitorsResult | null>(null);

  const run = (fn: () => Promise<CompetitorsResult>, after?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  return (
    <AppShell active="stats" updated={shell.updated} generatedAt={shell.generatedAt} activeRuns={shell.activeRuns} runwayDays={shell.runwayDays} runwayLabel={shell.runwayLabel}>
      <main className="page">
        <div className="page-head">
          <h1>Похожие каналы</h1>
          <div className="actions">
            <Link href="/stats" className="btn small ghost">
              ← Статистика
            </Link>
          </div>
        </div>
        <p className="muted small">
          Что выстрелило у похожих каналов за 30 дней — подсказка для новых тем. Берутся только открытые данные YouTube (≈3 единицы квоты на
          канал при каждом открытии страницы), ничего не сохраняется.
        </p>

        <section className="card">
          <h2>Каналы</h2>
          <form
            className={s.add}
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) run(() => addCompetitorAction(input), () => setInput(""));
            }}
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="@handle или ссылка на канал" aria-label="Канал" />
            <button className="btn primary" type="submit" disabled={pending || !input.trim()}>
              {pending ? "…" : "Добавить"}
            </button>
          </form>
          {refs.length > 0 && (
            <div className={s.chips}>
              {refs.map((ref) => (
                <span className="chip" key={ref}>
                  {ref}
                  <button className={s.remove} disabled={pending} aria-label={`Убрать ${ref}`} onClick={() => run(() => removeCompetitorAction(ref))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {result && <p className={`small ${result.ok ? "muted" : s.error}`}>{result.message}</p>}
        </section>

        {reports.length === 0 && (
          <p className="muted">Добавьте 3–5 каналов научпопа — панель покажет, какие их ролики набрали в разы больше обычного для них.</p>
        )}

        {reports.map((r) => (
          <section className="card" key={r.ref}>
            <h2>
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.title}
              </a>
            </h2>
            {r.error ? (
              <p className={`small ${s.error}`}>{r.error}</p>
            ) : (
              <>
                <p className="small muted">
                  {count(r.subscribers)} подписчиков · {r.uploadsPerWeek.toFixed(1)} роликов в неделю · обычно {compact.format(r.medianPerDay)} просм. в
                  сутки · коротких {Math.round(r.shortsShare * 100)}%
                </p>
                {r.hits.length ? (
                  <>
                    <h3 className={s.subhead}>🔥 Выстрелило</h3>
                    <ul className={s.list}>
                      {r.hits.map((v) => (
                        <VideoLine key={v.id} v={v} />
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="small muted">За 30 дней ничего не набрало заметно больше обычного.</p>
                )}
                {r.recent.length > 0 && (
                  <>
                    <h3 className={s.subhead}>Лучшие свежие</h3>
                    <ul className={s.list}>
                      {r.recent.map((v) => (
                        <VideoLine key={v.id} v={v} />
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        ))}
      </main>
    </AppShell>
  );
}
