import { STAGES, type Stage } from "@/lib/stages";

// Полоска из 6 шагов: тема → сценарий → видео → в Studio → запланирован → вышел.
export default function Dots({ stage }: { stage: Stage }) {
  const n = STAGES.indexOf(stage);
  return (
    <span className="dots" aria-label={`шаг ${n + 1} из ${STAGES.length}`}>
      {STAGES.map((s, i) => (
        <i key={s} className={i <= n ? "on" : ""} />
      ))}
    </span>
  );
}
