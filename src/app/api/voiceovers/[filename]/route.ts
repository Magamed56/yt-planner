import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const STORAGE_DIR = path.join(process.cwd(), "storage", "voiceovers");

// Раздаём сгенерированные mp3 отдельным роутом, а не через /public — next
// start не подхватывает файлы, добавленные в public/ уже после сборки (это
// работает только в next dev), а API-роут всегда читает диск заново.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  // Не пускаем выход за пределы папки через ../ в имени файла.
  if (filename.includes("/") || filename.includes("..")) {
    return NextResponse.json({ error: "invalid filename" }, { status: 400 });
  }

  try {
    const data = await readFile(path.join(STORAGE_DIR, filename));
    return new NextResponse(data, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return NextResponse.json({ error: "не найдено" }, { status: 404 });
  }
}
