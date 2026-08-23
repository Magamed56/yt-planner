"use client";

import { useState } from "react";
import type { VideoStage } from "@prisma/client";
import VideoList, { type VideoRow } from "@/components/VideoList";
import AddVideoForm from "@/components/AddVideoForm";

export default function ChannelBoard({
  channelId,
  stage,
  videos: initialVideos,
  availableStages,
}: {
  channelId: string;
  stage: VideoStage;
  videos: VideoRow[];
  availableStages: VideoStage[];
}) {
  const [videos, setVideos] = useState(initialVideos);
  const [typeFilter, setTypeFilter] = useState<"all" | "short" | "long">("all");

  const visibleVideos = videos.filter((v) => {
    if (typeFilter === "short") return v.isShort;
    if (typeFilter === "long") return !v.isShort;
    return true;
  });

  function handleAdded(video: VideoRow) {
    setVideos((prev) => [...prev, video]);
  }

  // Смена этапа могла увести видео с этой доски — убираем его из вида, если
  // новый этап больше не совпадает со страницей, на которой мы находимся.
  function handleUpdated(video: VideoRow) {
    setVideos((prev) => {
      const without = prev.filter((v) => v.id !== video.id);
      return video.stage === stage ? [...without, video] : without;
    });
  }

  function handleDeleted(video: VideoRow) {
    setVideos((prev) => prev.filter((v) => v.id !== video.id));
  }

  const filterOptions: { key: typeof typeFilter; label: string }[] = [
    { key: "all", label: "Все" },
    { key: "short", label: "Shorts" },
    { key: "long", label: "Видео" },
  ];

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          {filterOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setTypeFilter(opt.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                typeFilter === opt.key
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-ink-dim hover:border-line-strong hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <AddVideoForm channelId={channelId} defaultStage={stage} onAdded={handleAdded} />
      </div>
      <VideoList videos={visibleVideos} availableStages={availableStages} onUpdated={handleUpdated} onDeleted={handleDeleted} />
    </>
  );
}
