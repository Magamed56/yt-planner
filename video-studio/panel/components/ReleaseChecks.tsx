"use client";
// «Перед загрузкой проверьте» в карточке ролика: замечания QC, голос, откуда кадры. Один GET при
// открытии карточки; разобранное помним по id файлов релиза (новая сборка — новые id), так что
// повторное открытие той же карточки показывает сразу, без GitHub.
import { useEffect, useState } from "react";
import { FACTS_VERSION, releaseChecks, STOCK_SECRETS_LABEL, type CheckLevel, type ReleaseFacts, type VoiceRef } from "@/lib/checks";
import type { ReleaseInfo } from "@/lib/state";
import css from "./ReleaseChecks.module.css";

const cache = new Map<string, ReleaseFacts>();
const MARK: Record<CheckLevel, string> = { error: "✖", warn: "⚠", info: "•", ok: "✔" };
const TIMEOUT_MS = 25_000;
const NOTHING: ReleaseFacts = { qc: { state: "missing" }, credits: { state: "missing" } };

type Loaded = { key: string; facts: ReleaseFacts } | { key: string; error: string };

// Свои ошибки уже по-русски; у браузера — «Failed to fetch», «Load failed», «Unexpected token <».
function loadError(e: unknown): string {
  if (e instanceof TypeError) return "нет связи с панелью — проверьте интернет";
  if (e instanceof SyntaxError) return "панель прислала не то — обновите страницу";
  return e instanceof Error ? e.message : String(e);
}

export default function ReleaseChecks({
  release,
  voice,
  realPhotos,
  missingSecrets,
  title,
}: {
  release: Pick<ReleaseInfo, "qc" | "description">;
  voice: VoiceRef | null;
  realPhotos: boolean;
  missingSecrets: string[] | null;
  title: string;
}) {
  const qcId = release.qc?.id ?? null;
  const descId = release.description?.id ?? null;
  const key = `${qcId ?? "-"}:${descId ?? "-"}`;
  const empty = qcId === null && descId === null; // старый релиз: смотреть нечего, запрос не нужен
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (empty || cache.has(key)) return;
    const ctrl = new AbortController();
    let closed = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, TIMEOUT_MS);
    const params = new URLSearchParams({ v: String(FACTS_VERSION) });
    if (qcId !== null) params.set("qc", String(qcId));
    if (descId !== null) params.set("description", String(descId));
    fetch(`/api/release-checks?${params}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (res.status === 401) throw new Error("вход истёк — обновите страницу");
        if (!res.ok) throw new Error(`панель ответила ${res.status}`);
        return (await res.json()) as ReleaseFacts;
      })
      .then((facts) => {
        // Сбой GitHub по одному из файлов не запоминаем — при следующем открытии спросим заново.
        if (facts.qc.state !== "error" && facts.credits.state !== "error") cache.set(key, facts);
        if (!closed) setLoaded({ key, facts });
      })
      .catch((e: unknown) => {
        if (closed) return;
        setLoaded({ key, error: timedOut ? "GitHub не ответил за 25 с" : loadError(e) });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      closed = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, qcId, descId, empty, attempt]);

  const mine = loaded?.key === key ? loaded : null;
  const facts = empty ? NOTHING : (cache.get(key) ?? (mine && "facts" in mine ? mine.facts : null));
  const error = !facts && mine && "error" in mine ? mine.error : null;
  const lines = facts ? releaseChecks(facts, { voice, realPhotos, stockKeysMissing: missingSecrets === null ? null : missingSecrets.includes(STOCK_SECRETS_LABEL) }) : [];

  return (
    <section className={css.checks}>
      <h4>{title}</h4>
      {!facts && !error && <p className="muted small">Смотрю автопроверку и описание релиза…</p>}
      {error && (
        <p className="muted small">
          Проверку не загрузить: {error}.{" "}
          <button
            className="btn small"
            onClick={() => {
              setLoaded(null);
              setAttempt(attempt + 1);
            }}
          >
            Ещё раз
          </button>
        </p>
      )}
      {lines.length > 0 && (
        <ul className={css.list}>
          {lines.map((l, i) => (
            <li key={i} className={css[l.level]}>
              <span className={css.mark} aria-hidden="true">
                {MARK[l.level]}
              </span>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
