// Бренд-кит канала: аватары, баннер, водяной знак, обложки «Актуального» и
// пост-знакомство → папка brand/. Тексты (название, слоган, рубрики, время
// выхода) берутся из channel.json — после его правки просто перезапустите.
//
//   npm run brand
//   npm run brand -- --only=avatar,banner   (группы: avatar, banner, watermark, highlights, post, preview)
//   npm run brand -- --out=out/brand-test   (в другую папку, brand/ не трогать)
//   npm run brand -- --raw                  (без сжатия PNG до 256 цветов)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { bundle } from "@remotion/bundler";
import { RenderInternals, openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { getBrowserOptions } from "../pipeline/render";
import { brandJobs } from "../remotion/brand/jobs";
import { ROOT, UserError, argsError, fail, fmtDuration, loadEnv, rel } from "./common";

const HELP = `Бренд-кит канала → brand/ (PNG для YouTube Studio и Instagram).

  npm run brand [-- --only=avatar,banner,watermark,highlights,post,preview] [--out=папка] [--raw]

  --raw   не сжимать PNG (по умолчанию — палитра 256 цветов с дизерингом:
          на глаз то же самое, а файлы в 3–6 раз меньше)

Тексты и рубрики — из channel.json. Что куда загружать — brand/README.md.
`;

// Лимиты площадок на размер файла (справка YouTube): больше — Studio не примет.
const LIMITS: Record<string, { bytes: number; what: string }> = {
  "banner-youtube.png": { bytes: 6 * 1024 * 1024, what: "баннер YouTube (до 6 МБ)" },
  "avatar-youtube.png": { bytes: 4 * 1024 * 1024, what: "фото профиля YouTube (до 4 МБ)" },
  "watermark-youtube.png": { bytes: 1024 * 1024, what: "водяной знак YouTube (до 1 МБ)" },
};

const fmtSize = (b: number): string => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} МБ` : `${Math.round(b / 1024)} КБ`);

// Chromium пишет PNG с шумом дизеринга в градиентах — такие файлы плохо жмутся
// (1,6 МБ на обложку). Палитра 256 цветов + диффузия ошибки (ffmpeg, который
// везёт сам Remotion, — работает и на Windows) даёт тот же вид в 3–6 раз легче.
// Сжатый файл берём, только если он и правда меньше; любая ошибка — оставляем исходник.
async function compressPng(file: string): Promise<boolean> {
  const tmp = `${file}.pal.png`;
  try {
    await RenderInternals.callFf({
      bin: "ffmpeg",
      args: ["-y", "-loglevel", "error", "-i", file, "-filter_complex", "[0:v]split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a", "-pix_fmt", "pal8", tmp],
      indent: false,
      logLevel: "error",
      binariesDirectory: null,
      cancelSignal: undefined,
    });
    if (fs.statSync(tmp).size < fs.statSync(file).size) {
      fs.renameSync(tmp, file);
      return true;
    }
    fs.rmSync(tmp, { force: true });
    return false;
  } catch {
    fs.rmSync(tmp, { force: true });
    return false;
  }
}

function readPillarIds(): string[] {
  const file = path.join(ROOT, "channel.json");
  if (!fs.existsSync(file)) throw new UserError(`Нет ${rel(file)} — в нём название, слоган и рубрики канала.`);
  let data: { pillars?: { id?: unknown }[] };
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8")) as typeof data;
  } catch (e) {
    throw new UserError(`${rel(file)}: битый JSON (${e instanceof Error ? e.message : String(e)}). Проверьте запятые и кавычки.`);
  }
  const ids = (data.pillars ?? []).map((p) => (typeof p.id === "string" ? p.id.trim() : "")).filter(Boolean);
  // id идёт в имя файла — только безопасные символы (и на Windows тоже).
  const bad = ids.filter((id) => !/^[a-z0-9_-]+$/i.test(id));
  if (bad.length) throw new UserError(`channel.json → pillars[].id: допустимы латиница, цифры, «-» и «_», а не ${bad.map((b) => `«${b}»`).join(", ")}.`);
  return ids;
}

async function main() {
  const t0 = Date.now();
  loadEnv();
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: process.argv.slice(2),
      options: {
        only: { type: "string" },
        out: { type: "string" },
        raw: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    }).values;
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const all = brandJobs(readPillarIds());
  const groups = [...new Set(all.map((j) => j.group))];
  const only = typeof values.only === "string" ? values.only.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const unknown = only?.filter((g) => !groups.includes(g)) ?? [];
  if (unknown.length) throw new UserError(`--only: нет групп ${unknown.join(", ")}. Есть: ${groups.join(", ")}.`);
  const jobs = only ? all.filter((j) => only.includes(j.group)) : all;
  const outDir = path.resolve(typeof values.out === "string" ? values.out : path.join(ROOT, "brand"));

  console.log(`video-studio · бренд-кит → ${rel(outDir)} (${jobs.length} PNG)`);
  const browserOpts = await getBrowserOptions();

  // Свой временный каталог бандла с уборкой, как в render.ts; publicDir пустой:
  // шрифты идут через webpack, картинок бренду не нужно.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "video-studio-brand-"));
  const publicDir = path.join(tmp, "public");
  fs.mkdirSync(publicDir);
  try {
    const tb = Date.now();
    const serveUrl = await bundle({
      entryPoint: path.join(ROOT, "src", "remotion", "index.ts"),
      publicDir,
      outDir: path.join(tmp, "bundle"),
      enableCaching: true,
    });
    console.log(`[бренд] композиции собраны за ${fmtDuration(Date.now() - tb)}`);

    const browser = await openBrowser("chrome", { ...browserOpts, logLevel: "warn" });
    const warnings: string[] = [];
    try {
      for (const job of jobs) {
        const output = path.join(outDir, ...job.file.split("/"));
        fs.mkdirSync(path.dirname(output), { recursive: true });
        const inputProps = job.inputProps ?? {};
        const composition = await selectComposition({ serveUrl, id: job.compositionId, inputProps, puppeteerInstance: browser, ...browserOpts, logLevel: "error" });
        await renderStill({ serveUrl, composition, inputProps, output, frame: 0, imageFormat: "png", overwrite: true, puppeteerInstance: browser, ...browserOpts, logLevel: "error" });
        const before = fs.statSync(output).size;
        const packed = !values.raw && job.compress !== false && (await compressPng(output));
        const size = fs.statSync(output).size;
        console.log(`[бренд] ${rel(output)} — ${composition.width}×${composition.height}, ${fmtSize(size)}${packed ? ` (было ${fmtSize(before)})` : ""}`);
        const limit = LIMITS[job.file];
        if (limit && size > limit.bytes) warnings.push(`${job.file}: ${fmtSize(size)} — больше лимита: ${limit.what}. Пережмите файл (например, в squoosh.app) перед загрузкой.`);
      }
    } finally {
      await browser.close({ silent: true });
    }
    for (const w of warnings) console.warn(`⚠ ${w}`);
    console.log(`\n✔ Готово за ${fmtDuration(Date.now() - t0)}. Что куда загружать — brand/README.md.`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(fail);
