import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uniqueConstraintResponse } from "@/lib/apiErrors";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const channel = await prisma.channel.findUnique({
    where: { id },
    include: { videos: { orderBy: { createdAt: "asc" } } },
  });
  if (!channel) return NextResponse.json({ error: "не найдено" }, { status: 404 });
  return NextResponse.json(channel);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  try {
    const channel = await prisma.channel.update({
      where: { id },
      data: {
        name: body.name,
        niche: body.niche !== undefined ? (body.niche?.trim() || null) : undefined,
        notes: body.notes !== undefined ? (body.notes?.trim() || null) : undefined,
      },
    });
    return NextResponse.json(channel);
  } catch (e) {
    const conflict = uniqueConstraintResponse(e, "Канал с таким названием уже существует");
    if (conflict) return conflict;
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.channel.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
