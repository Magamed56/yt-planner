"use client";
// Просмотры вышедших роликов по дате выхода — один ряд столбиков (последние 20). Подсказка с
// названием и цифрами — по наведению, фокусу и нажатию; те же цифры есть в списке «Ролики» ниже.
import { useState } from "react";

export interface ChartBar {
  key: string;
  label: string; // «02a · чт 08.10»
  title: string;
  value: number;
  valueLabel: string; // «9,8 тыс.»
  sub: string; // «9,1 тыс. в сутки»
}

const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", roundingMode: "trunc" });

// Верх оси — «круглое» число не меньше максимума: 1, 2, 2.5, 5 × 10^n.
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

export default function ViewsChart({ bars, caption }: { bars: ChartBar[]; caption: string }) {
  const [active, setActive] = useState<number | null>(null);
  if (!bars.length) return null;
  const top = niceMax(Math.max(...bars.map((b) => b.value)));
  const best = bars.reduce((a, b, i) => (b.value > bars[a]!.value ? i : a), 0);
  const shown = active ?? best;
  const cur = bars[shown]!;
  return (
    <figure className="vchart">
      <figcaption className="vchart-head">
        <span className="small muted">{caption}</span>
        <span className="vchart-tip" aria-live="polite">
          <b>{cur.valueLabel}</b> {cur.label}
          <span className="muted"> · {cur.sub}</span>
          <span className="vchart-title">{cur.title}</span>
        </span>
      </figcaption>
      <div className="vchart-plot" onPointerLeave={() => setActive(null)}>
        <div className="vchart-grid" aria-hidden="true">
          {[top, top / 2, 0].map((t) => (
            <span key={t} data-v={compact.format(t)} />
          ))}
        </div>
        <div className="vchart-bars" role="list">
          {bars.map((b, i) => (
            <button
              key={b.key}
              type="button"
              role="listitem"
              className={`vchart-col${i === shown ? " on" : ""}`}
              aria-label={`${b.label}: ${b.valueLabel} просмотров`}
              onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
            >
              <span className="vchart-bar" style={{ height: `${Math.max(1.5, (b.value / top) * 100)}%` }} />
            </button>
          ))}
        </div>
      </div>
      <div className="vchart-axis small muted" aria-hidden="true">
        <span>{bars[0]!.label.split(" · ")[1] ?? ""}</span>
        <span>{bars.at(-1)!.label.split(" · ")[1] ?? ""}</span>
      </div>
    </figure>
  );
}
