// Бренд-кит канала: аватары, баннер, водяной знак, обложки «Актуального» и
// пост-знакомство → папка brand/. Тексты (название, слоган, рубрики, число роликов
// в день) берутся из файла канала (channel.json, с --channel — channels/<язык>.json),
// надписи языка — из src/remotion/brand/texts.ts. После правки просто перезапустите.
//
//   npm run brand
//   npm run brand -- --channel=en           (канал channels/en.json → brand/en/)
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
import { DEFAULT_LANG, channelFileForLang, knownLangs, normalizeLang } from "../pipeline/lang";
import { BRAND_CHANNEL_PROP, brandJobs } from "../remotion/brand/jobs";
import { BRAND_TEXTS } from "../remotion/brand/texts";
import { ROOT, UserError, argsError, fail, fmtDuration, loadEnv, rel } from "./common";

const HELP = `Бренд-кит канала → brand/ (PNG для YouTube Studio и Instagram).

  npm run brand [-- --channel=en] [--only=avatar,banner,watermark,highlights,post,preview] [--out=папка] [--raw]

  --channel  канал другого языка: channels/<язык>.json → brand/<язык>/
             (без флага — channel.json → brand/)
  --raw      не сжимать PNG (по умолчанию — палитра 256 цветов с дизерингом:
             на глаз то же самое, а файлы в 3–6 раз меньше)

Тексты и рубрики — из файла канала. Что куда загружать — brand/README.md (английский канал — brand/en/README.md).
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

// Файл канала целиком уходит в inputProps (ключ BRAND_CHANNEL_PROP) — композиции берут
// название, ник, слоган, рубрики и язык надписей из него, а не из вшитого channel.json.
interface BrandChannel {
  lang: string;
  file: string;
  json: Record<string, unknown>;
  pillarIds: string[];
}

function readChannel(lang: string): BrandChannel {
  const relFile = channelFileForLang(lang);
  const file = path.join(ROOT, ...relFile.split("/"));
  if (!fs.existsSync(file)) {
    throw new UserError(`Нет ${relFile} — в нём название, слоган и рубрики канала.${lang === DEFAULT_LANG ? "" : " Скопируйте channels/en.json и переведите тексты."}`);
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
  } catch (e) {
    throw new UserError(`${relFile}: битый JSON (${e instanceof Error ? e.message : String(e)}). Проверьте запятые и кавычки.`);
  }
  // Заготовка без ника — на картинках вышло бы «@» в пустоте: сначала канал создают и вписывают ник.
  const handle = typeof json.handle === "string" ? json.handle.trim() : "";
  if (json.placeholder === true || !handle) {
    const again = lang === DEFAULT_LANG ? "npm run brand" : `npm run brand -- --channel=${lang}`;
    throw new UserError(`${relFile} — заготовка: впишите name и handle созданного канала, удалите "_todo" и "placeholder", затем снова ${again}.`);
  }
  const language = typeof json.language === "string" ? json.language : DEFAULT_LANG;
  if (!BRAND_TEXTS[language]) {
    throw new UserError(`${relFile}: надписей бренд-кита на «${language}» пока нет (есть: ${Object.keys(BRAND_TEXTS).join(", ")}). Добавьте язык в src/remotion/brand/texts.ts.`);
  }
  const pillars = Array.isArray(json.pillars) ? (json.pillars as { id?: unknown }[]) : [];
  const pillarIds = pillars.map((p) => (typeof p?.id === "string" ? p.id.trim() : "")).filter(Boolean);
  if (!pillarIds.length || typeof json.name !== "string" || typeof json.tagline !== "string") {
    throw new UserError(`${relFile}: нужны name, tagline и pillars (рубрики с id, title, icon) — как в channel.json.`);
  }
  // id идёт в имя файла — только безопасные символы (и на Windows тоже).
  const bad = pillarIds.filter((id) => !/^[a-z0-9_-]+$/i.test(id));
  if (bad.length) throw new UserError(`${relFile} → pillars[].id: допустимы латиница, цифры, «-» и «_», а не ${bad.map((b) => `«${b}»`).join(", ")}.`);
  return { lang, file: relFile, json, pillarIds };
}

async function main() {
  const t0 = Date.now();
  loadEnv();
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: process.argv.slice(2),
      options: {
        channel: { type: "string" },
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

  let lang = DEFAULT_LANG;
  if (typeof values.channel === "string") {
    const code = normalizeLang(values.channel);
    if (!code) throw new UserError(`--channel: не знаю язык «${values.channel}». Доступны: ${knownLangs()}.`);
    lang = code;
  }
  const channel = readChannel(lang);
  const all = brandJobs(channel.pillarIds);
  const groups = [...new Set(all.map((j) => j.group))];
  const only = typeof values.only === "string" ? values.only.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const unknown = only?.filter((g) => !groups.includes(g)) ?? [];
  if (unknown.length) throw new UserError(`--only: нет групп ${unknown.join(", ")}. Есть: ${groups.join(", ")}.`);
  const jobs = only ? all.filter((j) => only.includes(j.group)) : all;
  // Русский кит — в brand/, как раньше; канал другого языка — в brand/<язык>/ рядом.
  const brandDir = lang === DEFAULT_LANG ? path.join(ROOT, "brand") : path.join(ROOT, "brand", lang);
  const outDir = path.resolve(typeof values.out === "string" ? values.out : brandDir);
  const readme = rel(path.join(brandDir, "README.md"));

  console.log(`video-studio · бренд-кит «${String(channel.json.name)}» (${channel.file}) → ${rel(outDir)} (${jobs.length} PNG)`);
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
        const inputProps = { ...job.inputProps, [BRAND_CHANNEL_PROP]: channel.json };
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
    console.log(`\n✔ Готово за ${fmtDuration(Date.now() - t0)}. Что куда загружать — ${readme}.`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(fail);
