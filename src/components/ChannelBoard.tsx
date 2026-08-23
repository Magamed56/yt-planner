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

  return (
    <>
      <div className="mb-6 flex justify-end">
        <AddVideoForm channelId={channelId} defaultStage={stage} onAdded={handleAdded} />
      </div>
      <VideoList videos={videos} availableStages={availableStages} onUpdated={handleUpdated} onDeleted={handleDeleted} />
    </>
  );
}
