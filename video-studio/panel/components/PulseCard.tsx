"use client";
// «Пульс»: что изменилось с прошлого визита и последние вышедшие Shorts с «×N к обычному».
// Прошлый визит помнит этот браузер (localStorage) — у телефона и компьютера он свой. Текст
// «с прошлого визита» появляется после загрузки страницы: сервер не знает, когда вы заходили.
import { RATIO_CLASS } from "@/lib/stages";
import { useEffect, useState } from "react";
import { crossedMilestone, seriesAt, shortCount, type Pulse } from "@/lib/pulse";

const SEEN_KEY = "sut.lastSeen";
const WEEK_MS = 7 * 86_400_000;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${shortCount(Math.abs(n))}`;

export default function PulseCard({ pulse, timeZone, onOpen }: { pulse: Pulse; timeZone: string; onOpen: (code: string) => void }) {
  const [line, setLine] = useState<{ head: string; parts: string[]; failed: string[]; party: string | null } | null>(null);

  useEffect(() => {
    const st = storage();
    const now = Date.now();
    const raw = Number(st?.getItem(SEEN_KEY) ?? NaN);
    const seen = Number.isFinite(raw) && now - raw < WEEK_MS && raw < now ? raw : now - 86_400_000;
    const when = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(seen);
    const head = Number.isFinite(raw) && raw === seen ? `С прошлого визита (${when})` : "За сутки";
    const last = pulse.series.at(-1);
    const before = seriesAt(pulse.series, seen);
    const parts: string[] = [];
    if (last && before) {
      const dv = last[1] - before.views;
      const ds = last[2] !== null && before.subs !== null ? last[2] - before.subs : null;
      if (dv) parts.push(`👁 ${before.approx ? "≈ " : ""}${signed(dv)}`);
      if (ds) parts.push(`👥 ${signed(ds)}`);
    }
    const since = pulse.events.filter((e) => Date.parse(e.at) > seen);
    const codes = (kind: string) => [...new Set(since.filter((e) => e.kind === kind && e.code).map((e) => e.code!))];
    const out = codes("published");
    const built = codes("built");
    const list = (xs: string[]) => (xs.length > 4 ? `${xs.slice(0, 4).join(", ")} и ещё ${xs.length - 4}` : xs.join(", "));
    if (out.length) parts.push(`${out.length > 1 ? "вышли" : "вышел"} ${list(out)}`);
    if (built.length) parts.push(`${built.length > 1 ? "собраны" : "собран"} ${list(built)}`);
    const failed = since.filter((e) => e.kind === "failed").map((e) => e.text);
    if (!last) parts.push("рост появится после первых снимков");
    // Рубеж подписчиков — поздравляем один раз.
    const m = crossedMilestone(before?.subs ?? null, last?.[2] ?? null);
    let party: string | null = null;
    if (m && st?.getItem(`sut.milestone.${m}`) !== "1") {
      party = `🎉 ${m.toLocaleString("ru-RU")} подписчиков!`;
      try {
        st?.setItem(`sut.milestone.${m}`, "1");
      } catch {
        // поздравим ещё раз — не страшно
      }
    }
    setLine({ head: parts.length || failed.length ? head : `Без изменений с ${when}`, parts, failed, party });

    // Прошлый визит — когда вкладку закрыли или свернули: при следующем открытии здесь ещё он.
    const save = () => {
      try {
        st?.setItem(SEEN_KEY, String(Date.now()));
      } catch {
        // без памяти о визите — покажем «за сутки»
      }
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [pulse, timeZone]);

  if (!pulse.recent.length && !pulse.events.length && !pulse.series.length) return null;
  return (
    <section className="pulse" aria-label="Пульс канала" title="С прошлого визита в этом браузере (у телефона и компьютера — свой)">
      <p className="pulse-line small">
        {line ? (
          <>
            {line.party && <b className="pulse-party">{line.party} </b>}
            <b>{line.head}</b>
            {line.parts.length > 0 && `: ${line.parts.join(" · ")}`}
            {line.failed.map((f) => (
              <span key={f} className="pulse-failed">
                {" "}
                · ✕ {f}
              </span>
            ))}
          </>
        ) : (
          " "
        )}
      </p>
      {pulse.recent.length > 0 && (
        <div className="pulse-strip">
          {pulse.recent.map((r) => (
            <button key={r.code} type="button" className="pulse-item" onClick={() => onOpen(r.code)} title={`Карточка ${r.code}`}>
              {r.cover ? <img src={r.cover} alt="" loading="lazy" /> : <span className="ph">{r.code}</span>}
              <span className="pulse-text">
                <span>
                  <b>{r.code}</b> · {r.whenLabel}
                </span>
                <span>
                  👁 {r.viewsLabel}
                  {r.ratioLabel && <span className={`ratio ${RATIO_CLASS[r.verdict ?? "typical"]}`}>{r.ratioLabel}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
