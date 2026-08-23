import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Видео, которым пора публиковаться: этап READY, файл указан, план публикации
// уже наступил, ещё не загружено. Используется планировщиком (scripts/scheduler.js).
export async function GET() {
  const due = await prisma.video.findMany({
    where: {
      stage: "READY",
      youtubeVideoId: null,
      videoFilePath: { not: null },
      plannedPublishAt: { lte: new Date() },
    },
    orderBy: { plannedPublishAt: "asc" },
  });
  return NextResponse.json(due);
}
