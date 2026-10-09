// Какие ролики с этого компьютера залить в релизы GitHub (src/cli/release-upload.ts): сопоставление
// роликов из списков youtube-fill с файлами на диске и с уже существующими релизами. Чистые
// функции — проверяются в src/dev/release-test.ts без сети и диска.
import path from "node:path";
import type { FillItem } from "./youtube-fill";

export const MP4_WITH_CODE = /^(\d{2}[a-z])-.+\.mp4$/i; // как в панели: релиз узнаётся по файлу «08a-….mp4»
export const SIDE_FILES = ["cover.jpg", "thumbnail.png", "instagram.txt", "description.txt", "captions.srt"];

// Что нашлось на диске: готовый файл «01a-….mp4» или папка рендера out/<ролик>/.
export type LocalVideo =
  | { kind: "named"; path: string; name: string }
  | { kind: "outdir"; dir: string; name: string; title: string | null; files: string[] };

export interface UploadPlan {
  item: FillItem;
  video: string; // путь к mp4
  extras: string[]; // обложки и подписи из папки рендера
  others: string[]; // ещё файлы с тем же именем в других папках — какой ушёл на YouTube, неизвестно
}

export const slugOf = (file: string) => file.replace(/^\d{2}[a-z]-/i, "");

// Тег — латиница из имени файла; слишком длинные GitHub не любит.
export function releaseTag(item: FillItem): string {
  return `video-${item.id.toLowerCase()}-${slugOf(item.file)}`.slice(0, 100).replace(/[-.]+$/, "");
}

// Коды, у которых уже есть релиз с «<код>-….mp4» (панель берёт видео оттуда).
export function codesWithRelease(releases: { draft?: boolean; assets?: { name: string }[] }[]): Set<string> {
  const out = new Set<string>();
  for (const r of releases) {
    if (r.draft) continue;
    for (const a of r.assets ?? []) {
      const m = MP4_WITH_CODE.exec(a.name);
      if (m) out.add(m[1]!.toLowerCase());
    }
  }
  return out;
}

// Ролик ↔ файл на диске: по имени «01a-….mp4», по папке out/<слаг> (слаги бывают обрезаны) или по
// названию из youtube.json в папке рендера.
export function matchLocal(items: FillItem[], found: LocalVideo[]): Map<string, UploadPlan> {
  const out = new Map<string, UploadPlan>();
  const norm = (s: string) => s.trim().toLowerCase();
  for (const item of items) {
    // «01a-….mp4» и копии браузера «01a-… (1).mp4» в разных папках — все кандидаты.
    const named = found.filter(
      (f): f is Extract<LocalVideo, { kind: "named" }> => f.kind === "named" && norm(f.name).replace(/ \(\d+\)(?=\.mp4$)/, "") === norm(`${item.file}.mp4`),
    );
    if (named.length) {
      out.set(item.id, { item, video: named[0]!.path, extras: [], others: named.slice(1).map((f) => f.path) });
      continue;
    }
    const slug = norm(slugOf(item.file));
    const dir = found.find(
      (f): f is Extract<LocalVideo, { kind: "outdir" }> =>
        f.kind === "outdir" &&
        f.files.includes("video.mp4") &&
        (norm(f.name) === slug ||
          (slug.length >= 20 && (norm(f.name).startsWith(slug) || slug.startsWith(norm(f.name)))) ||
          (f.title !== null && norm(f.title) === norm(item.title))),
    );
    if (dir) out.set(item.id, { item, video: path.join(dir.dir, "video.mp4"), extras: SIDE_FILES.filter((n) => dir.files.includes(n)).map((n) => path.join(dir.dir, n)), others: [] });
  }
  return out;
}
