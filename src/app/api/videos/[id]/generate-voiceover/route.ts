import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { generateVoiceover, extractNarration } from "@/lib/tts";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) return NextResponse.json({ error: "не найдено" }, { status: 404 });

  const scriptText = (body.script ?? video.script)?.trim();
  if (!scriptText) {
    return NextResponse.json({ error: "Нет текста сценария для озвучки" }, { status: 400 });
  }

  let audio: Buffer;
  try {
    audio = await generateVoiceover(extractNarration(scriptText));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Не удалось сгенерировать озвучку";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const dir = path.join(process.cwd(), "storage", "voiceovers");
  await mkdir(dir, { recursive: true });
  const fileName = `${id}-${Date.now()}.mp3`;
  await writeFile(path.join(dir, fileName), audio);

  const voiceoverPath = `/api/voiceovers/${fileName}`;
  const updated = await prisma.video.update({
    where: { id },
    data: { voiceoverPath },
    include: { stageEvents: true },
  });

  return NextResponse.json(updated);
}
