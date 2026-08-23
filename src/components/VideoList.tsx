import type { VideoStage } from "@prisma/client";
import VideoCard from "@/components/VideoCard";

export type VideoRow = {
  id: string;
  channelId: string;
  title: string;
  idea: string | null;
  script: string | null;
  isShort: boolean;
  stage: VideoStage;
  plannedPublishAt: Date | null;
  publishedAt: Date | null;
  videoUrl: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  stageEvents: { id: string; stage: VideoStage; note: string | null; createdAt: Date }[];
};

export default function VideoList({
  videos,
  availableStages,
  onUpdated,
  onDeleted,
}: {
  videos: VideoRow[];
  availableStages: VideoStage[];
  onUpdated?: (video: VideoRow) => void;
  onDeleted?: (video: VideoRow) => void;
}) {
  if (videos.length === 0) {
    return <p className="text-ink-faint text-sm py-6">Пока пусто.</p>;
  }

  return (
    <div className="space-y-2">
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} availableStages={availableStages} onUpdated={onUpdated} onDeleted={onDeleted} />
      ))}
    </div>
  );
}
