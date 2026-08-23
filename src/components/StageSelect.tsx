"use client";

import { useState } from "react";
import type { VideoStage } from "@prisma/client";
import { STAGE_LABELS } from "@/lib/stages";
import type { VideoRow } from "@/components/VideoList";

export default function StageSelect({
  videoId,
  currentStage,
  stages,
  onChanged,
}: {
  videoId: string;
  currentStage: VideoStage;
  stages: VideoStage[];
  onChanged?: (video: VideoRow) => void;
}) {
  const [value, setValue] = useState(currentStage);

  async function change(next: VideoStage) {
    const prev = value;
    setValue(next);
    const res = await fetch(`/api/videos/${videoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: next }),
    });
    if (!res.ok) {
      setValue(prev);
      alert("Не удалось сменить этап");
      return;
    }
    const updated = await res.json();
    onChanged?.({
      ...updated,
      stageEvents: updated.stageEvents.map((ev: { createdAt: string }) => ({ ...ev, createdAt: new Date(ev.createdAt) })),
    });
  }

  return (
    <select
      value={value}
      onChange={(e) => change(e.target.value as VideoStage)}
      className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink-dim outline-none transition-all duration-200 focus:border-accent focus:bg-surface-3 focus:ring-1 focus:ring-accent-soft cursor-pointer"
    >
      {stages.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
