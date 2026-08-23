import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadVideoToYoutube } from "@/lib/youtube";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) return NextResponse.json({ error: "не найдено" }, { status: 404 });

  const filePath = (body.videoFilePath ?? video.videoFilePath)?.trim();
  if (!filePath) {
    return NextResponse.json({ error: "Не указан путь к файлу видео" }, { status: 400 });
  }
  const privacyStatus = body.privacyStatus ?? video.privacyStatus;

  let uploaded: { youtubeVideoId: string; videoUrl: string };
  try {
    uploaded = await uploadVideoToYoutube({
      filePath,
      title: video.title,
      description: [video.idea, video.notes].filter(Boolean).join("\n\n"),
      privacyStatus,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Не удалось загрузить видео";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const [updated] = await prisma.$transaction([
    prisma.video.update({
      where: { id },
      data: {
        stage: "PUBLISHED",
        publishedAt: new Date(),
        videoUrl: uploaded.videoUrl,
        youtubeVideoId: uploaded.youtubeVideoId,
        videoFilePath: filePath,
        privacyStatus,
      },
      include: { stageEvents: true },
    }),
    prisma.videoStageEvent.create({
      data: { videoId: id, stage: "PUBLISHED", note: "загружено на YouTube автоматически" },
    }),
  ]);

  return NextResponse.json(updated);
}
