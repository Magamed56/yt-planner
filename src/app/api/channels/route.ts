import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uniqueConstraintResponse } from "@/lib/apiErrors";

export async function GET() {
  const channels = await prisma.channel.findMany({
    include: { videos: true },
    orderBy: { name: "asc" },
  });
  const result = channels.map((c) => ({
    id: c.id,
    name: c.name,
    niche: c.niche,
    videoTotal: c.videos.length,
    published: c.videos.filter((v) => v.stage === "PUBLISHED").length,
  }));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name) {
    return NextResponse.json({ error: "Название обязательно" }, { status: 400 });
  }
  try {
    const channel = await prisma.channel.create({
      data: {
        name: body.name,
        niche: body.niche?.trim() || null,
        notes: body.notes?.trim() || null,
      },
    });
    return NextResponse.json(channel, { status: 201 });
  } catch (e) {
    const conflict = uniqueConstraintResponse(e, "Канал с таким названием уже существует");
    if (conflict) return conflict;
    throw e;
  }
}
