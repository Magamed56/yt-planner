import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: channelId } = await params;
  const body = await req.json();
  if (!body.title) {
    return NextResponse.json({ error: "Название обязательно" }, { status: 400 });
  }
  const stage = body.stage ?? "IDEA";
  const video = await prisma.video.create({
    data: {
      channelId,
      title: body.title,
      idea: body.idea?.trim() || null,
      script: body.script?.trim() || null,
      stage,
      plannedPublishAt: body.plannedPublishAt ? new Date(body.plannedPublishAt) : null,
      videoUrl: body.videoUrl?.trim() || null,
      notes: body.notes?.trim() || null,
      stageEvents: { create: { stage, note: "создано" } },
    },
    include: { stageEvents: true },
  });
  return NextResponse.json(video, { status: 201 });
}
