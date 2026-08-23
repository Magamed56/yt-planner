import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  // Переход на "Опубликовано" без явной даты — считаем, что это произошло
  // прямо сейчас (можно поправить вручную, если публикация была раньше).
  const publishedAt =
    body.stage === "PUBLISHED"
      ? body.publishedAt
        ? new Date(body.publishedAt)
        : new Date()
      : body.publishedAt !== undefined
        ? body.publishedAt
          ? new Date(body.publishedAt)
          : null
        : undefined;

  try {
    const [video] = await prisma.$transaction([
      prisma.video.update({
        where: { id },
        data: {
          title: body.title ?? undefined,
          idea: body.idea !== undefined ? (body.idea?.trim() || null) : undefined,
          script: body.script !== undefined ? (body.script?.trim() || null) : undefined,
          stage: body.stage ?? undefined,
          plannedPublishAt:
            body.plannedPublishAt !== undefined
              ? body.plannedPublishAt
                ? new Date(body.plannedPublishAt)
                : null
              : undefined,
          publishedAt,
          videoUrl: body.videoUrl !== undefined ? (body.videoUrl?.trim() || null) : undefined,
          notes: body.notes !== undefined ? (body.notes?.trim() || null) : undefined,
        },
        include: { stageEvents: true },
      }),
      ...(body.stage
        ? [
            prisma.videoStageEvent.create({
              data: { videoId: id, stage: body.stage, note: body.stageNote ?? null },
            }),
          ]
        : []),
    ]);
    return NextResponse.json(video);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json({ error: "не найдено" }, { status: 404 });
    }
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.video.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
