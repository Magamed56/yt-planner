import { notFound } from "next/navigation";
import type { VideoStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { STAGE_LABELS, STAGE_ORDER, stageFromSlug } from "@/lib/stages";
import StageTabs from "@/components/StageTabs";
import ChannelBoard from "@/components/ChannelBoard";

export const dynamic = "force-dynamic";

export default async function ChannelStagePage({
  params,
}: {
  params: Promise<{ id: string; stage: string }>;
}) {
  const { id, stage: stageSlug } = await params;
  const stage = stageFromSlug(stageSlug);
  if (!stage) notFound();

  const channel = await prisma.channel.findUnique({
    where: { id },
    include: {
      videos: {
        orderBy: { createdAt: "asc" },
        include: { stageEvents: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!channel) notFound();

  const counts = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as Record<VideoStage, number>;
  for (const video of channel.videos) counts[video.stage] += 1;

  const videos = channel.videos.filter((v) => v.stage === stage);

  return (
    <main className="mx-auto max-w-[1400px] px-6 md:px-10 py-[clamp(40px,8vh,80px)]">
      <div className="mb-8">
        <p className="text-ink-faint text-sm mb-1">{channel.name}</p>
        <h1 className="text-[clamp(28px,4vw,40px)] text-ink font-bold">{STAGE_LABELS[stage]}</h1>
      </div>

      <div className="mb-8">
        <StageTabs channelId={channel.id} counts={counts} current={stage} />
      </div>

      <ChannelBoard channelId={channel.id} stage={stage} videos={videos} availableStages={STAGE_ORDER} />
    </main>
  );
}
