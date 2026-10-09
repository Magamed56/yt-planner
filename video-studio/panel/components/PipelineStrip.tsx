"use client";
// «Конвейер» под шапкой ленты: до какого дня подряд, без пропусков, хватает роликов на каждом
// этапе — запланированных, готовых видео, сценариев и тем. Нажатие — лента с этим этапом.
import type { Coverage, CoverageLevel } from "@/lib/state";

const LABEL: Record<CoverageLevel, string> = { scheduled: "На YouTube", video: "Видео", script: "Сценарии", topic: "Темы" };
const SCALE_DAYS = 14; // полная полоска — две недели выхода

export default function PipelineStrip({ coverage, perDay, gridSlots, onPick }: { coverage: Coverage[]; perDay: number; gridSlots: number; onPick: (level: CoverageLevel) => void }) {
  if (!coverage.length || !perDay) return null;
  return (
    <nav className="pipeline" aria-label="Конвейер: на сколько вперёд хватает роликов">
      {coverage.map((c) => {
        const until = c.slots >= gridSlots ? "60+ дней" : c.untilLabel ? `до ${/\d{2}\.\d{2}/.exec(c.untilLabel)?.[0] ?? c.untilLabel}` : "нет";
        const part = Math.min(1, c.slots / (SCALE_DAYS * perDay));
        return (
          <button key={c.level} type="button" className={`pipe-seg${c.slots ? "" : " empty"}`} onClick={() => onPick(c.level)} title={c.untilLabel ? `${LABEL[c.level]}: без пропусков до ${c.untilLabel}` : `${LABEL[c.level]}: ближайший слот не закрыт`}>
            <span className="pipe-label">{LABEL[c.level]}</span>
            <b>{until}</b>
            <span className="pipe-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(part * 100)}%` }} />
            </span>
          </button>
        );
      })}
    </nav>
  );
}
