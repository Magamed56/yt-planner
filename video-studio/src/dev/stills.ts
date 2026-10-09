// Dev: отрендерить контрольные кадры каждой сцены демо-ролика + обложку в PNG,
// чтобы глазами проверить вёрстку, не собирая видео целиком.
//
//   npx tsx src/dev/stills.ts
//   npx tsx src/dev/stills.ts --variants=shorts-midnight --scenes=1,4 --frames=mid
//
// Результат: out/dev/stills/<вариант>/<NN>-<kind>-<момент>.png и thumbnail-*.png
import fs from "node:fs";
import path from "node:path";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { buildFixtureProps } from "../remotion/fixtures/buildFixture";
import { chapterCardFrames, quizTiming, type Format, type SceneVisual, type ThemeName, type VideoProps, type VideoScript } from "../types";
import { OUT_DEV, bundleComposition, getBrowserOpts, parseArgs, preparePublicDir, readDemoScript } from "./devRender";

const SAMPLE_IMAGE_URL = "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/starry_night.jpg"; // public domain (Ван Гог)

// Пробуем скачать картинку-пример для проверки MediaLayer; не вышло — без неё.
async function fetchSample(cacheDir: string): Promise<string | null> {
  const file = path.join(cacheDir, "sample.jpg");
  if (fs.existsSync(file)) return file;
  try {
    const ctrl = AbortSignal.timeout(15000);
    const res = await fetch(SAMPLE_IMAGE_URL, { signal: ctrl });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch (e) {
    console.warn(`[stills] пример картинки не скачался (${String(e)}) — сцены с визуалом пропущены`);
    return null;
  }
}

interface Variant {
  name: string;
  format: Format;
  theme: ThemeName;
  withVisual: boolean;
  showCaptions: boolean;
  stress?: boolean; // длинные тексты на пределе — проверка, что ничего не вылезает
  extra?: (base: VideoScript) => VideoScript; // викторина / главы «Разбора»
  features?: boolean; // карта, сравнение, числа в тексте, фото «карточкой», бренд-заставка
}

// ---- Викторина и главы: кадры отсчёта, вердикта и карточки главы ----

function quizScript(base: VideoScript): VideoScript {
  return {
    ...base,
    scenes: [
      { id: "s1", kind: "hook", narration: "Проверь себя: правда или миф? Два факта о памяти.", onScreen: "Правда или *миф*?", icon: "brain" },
      { id: "s2", kind: "quiz", narration: "Говорят, золотая рыбка помнит всего три секунды. Правда или миф?", onScreen: "Рыбка помнит всего *3 секунды*", icon: "fish", quiz: { answer: "myth", explanation: "В опытах рыбки помнили сигнал месяцами" } },
      { id: "s3", kind: "statement", narration: "Миф! Золотые рыбки помнят трюки месяцами.", onScreen: "Помнят *месяцами*", icon: "calendar-check" },
      { id: "s4", kind: "quiz", narration: "Сон помогает закрепить выученное за день. Правда или миф?", onScreen: "Сон *закрепляет* память", icon: "moon", quiz: { answer: "truth", explanation: "Во сне мозг переносит знания в долгую память", question: "А ты высыпаешься?" } },
      { id: "s5", kind: "cta", narration: "Сколько угадал? Пиши в комментариях и подпишись.", onScreen: "Сколько *угадал*?", icon: "message-circle" },
    ],
  };
}

function chaptersScript(base: VideoScript): VideoScript {
  const titles: Record<string, string> = { s1: "Вступление", s3: "Почему мы забываем", s5: "Как запомнить надолго" };
  return { ...base, format: "landscape", scenes: base.scenes.map((s) => (titles[s.id] ? { ...s, chapter: titles[s.id] } : s)) };
}

// Сценарий с новыми возможностями: сравнение столбиками (s2), карта (s3),
// числа в экранном тексте (s4, s6), реальное горизонтальное фото на media (s5).
function featuresScript(base: VideoScript, format: Format): VideoScript {
  return {
    ...base,
    scenes: base.scenes.map((sc) => {
      if (sc.id === "s2") return { ...sc, kind: "statement" as const, stat: undefined, onScreen: "Что *быстрее* забывается", compare: { items: [{ label: "Через час", value: 44 }, { label: "Через сутки", value: 66 }, { label: "Через неделю", value: 77 }], suffix: "%" } };
      if (sc.id === "s3") return { ...sc, onScreen: "Эббингауз ставил опыты в *Берлине*", map: format === "shorts" ? { lat: 52.52, lon: 13.4, label: "Берлин", zoom: "region" as const } : { lat: 59.94, lon: 30.31, label: "Санкт-Петербург", zoom: "city" as const } };
      if (sc.id === "s4") return { ...sc, items: ["Повтори через 20 минут", "Через ≈28 000 секунд", "Через 3,5 дня"] };
      if (sc.id === "s6") return { ...sc, kind: "statement" as const, onScreen: "Так ты запомнишь в *10* раз больше — до 85%" };
      return sc;
    }),
  };
}

// Стресс-сценарий: onScreen ~60 символов, длинные пункты, огромное число,
// выдуманная иконка (должна стать Sparkles).
function stressScript(base: VideoScript): VideoScript {
  const long = [
    "Через двадцать четыре часа ты *забудешь* почти всё, что учил",
    "Исследование Эббингауза: кривая забывания и её последствия",
    "Мозг не ленится: он просто *экономит* драгоценную энергию",
    "Три научно доказанных способа *запомнить* надолго и без зубрёжки",
    "Интервальные повторения: день, три дня, неделя, месяц, *квартал*",
    "Обучая других людей, мы сами *учимся* гораздо глубже и быстрее",
    "*Подпишись* на канал, чтобы не пропустить следующий выпуск",
  ];
  return {
    ...base,
    scenes: base.scenes.map((sc, i) => ({
      ...sc,
      onScreen: long[i] ?? sc.onScreen,
      icon: i === 2 ? "definitely-not-an-icon" : sc.icon,
      items: sc.items ? ["Повторяй материал через увеличивающиеся интервалы", "Вспоминай без подсказок и проверяй себя", "Объясняй другим простыми словами", "Высыпайся: сон закрепляет память"] : sc.items,
      stat: sc.stat ? { value: 1250000, prefix: "≈", suffix: " млн", label: "нейронных связей перестраивается каждый день у взрослого человека" } : sc.stat,
    })),
  };
}

const VARIANTS: Variant[] = [
  { name: "shorts-midnight", format: "shorts", theme: "midnight", withVisual: false, showCaptions: true },
  { name: "landscape-sunset", format: "landscape", theme: "sunset", withVisual: false, showCaptions: true },
  { name: "shorts-emerald-visual", format: "shorts", theme: "emerald", withVisual: true, showCaptions: true },
  { name: "shorts-mono", format: "shorts", theme: "mono", withVisual: false, showCaptions: false },
  { name: "shorts-stress", format: "shorts", theme: "midnight", withVisual: false, showCaptions: true, stress: true },
  { name: "landscape-stress", format: "landscape", theme: "emerald", withVisual: false, showCaptions: true, stress: true },
  { name: "shorts-quiz", format: "shorts", theme: "midnight", withVisual: false, showCaptions: true, extra: quizScript },
  { name: "landscape-quiz", format: "landscape", theme: "emerald", withVisual: false, showCaptions: true, extra: quizScript },
  { name: "landscape-chapters", format: "landscape", theme: "sunset", withVisual: false, showCaptions: true, extra: chaptersScript },
  { name: "shorts-features", format: "shorts", theme: "midnight", withVisual: true, showCaptions: true, features: true },
  { name: "landscape-features", format: "landscape", theme: "sunset", withVisual: true, showCaptions: true, features: true },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wanted = args.variants ? args.variants.split(",") : VARIANTS.filter((v) => !v.stress).map((v) => v.name);
  const sceneFilter = args.scenes ? new Set(args.scenes.split(",").map((s) => Number(s) - 1)) : null;
  const moments = (args.frames ?? "early,mid,late").split(",");
  const thumbs = args.thumb !== "false";

  const publicDir = preparePublicDir("stills");
  const sample = await fetchSample(path.join(OUT_DEV, "cache"));
  if (sample) {
    fs.mkdirSync(path.join(publicDir, "visuals"), { recursive: true });
    fs.copyFileSync(sample, path.join(publicDir, "visuals", "sample.jpg"));
  }
  const serveUrl = await bundleComposition(publicDir, "stills");
  const browserOpts = await getBrowserOpts();
  const browser = await openBrowser("chrome", { ...browserOpts, logLevel: "warn" });
  const script = readDemoScript();
  const outRoot = path.join(OUT_DEV, "stills");
  let count = 0;
  const t0 = Date.now();

  try {
    for (const v of VARIANTS.filter((x) => wanted.includes(x.name))) {
      const visual = (id: string): SceneVisual => {
        if (!v.withVisual || !sample) return { type: "none" };
        // features: горизонтальное «реальное» фото на media — карточкой поверх размытой копии.
        if (v.features) return id === "s5" ? { type: "image", src: "visuals/sample.jpg", fit: "contain" } : { type: "none" };
        // Визуал на media-сцене (крупно) и на statement (приглушённым фоном).
        return id === "s5" || id === "s3" ? { type: "image", src: "visuals/sample.jpg" } : { type: "none" };
      };
      const base = v.extra ? v.extra(script) : script;
      const source = v.stress ? stressScript(base) : v.features ? featuresScript(base, v.format) : base;
      const props: VideoProps = buildFixtureProps(source, { format: v.format, theme: v.theme, visual, showCaptions: v.showCaptions, brandIntro: v.features });
      const inputProps = props as unknown as Record<string, unknown>;
      const dir = path.join(outRoot, v.name);
      // Не чистим папку: при --scenes/--frames остальные кадры остаются для сравнения.
      fs.mkdirSync(dir, { recursive: true });
      const composition = await selectComposition({ serveUrl, id: "Video", inputProps, puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });

      for (const [i, s] of props.scenes.entries()) {
        if (sceneFilter && !sceneFilter.has(i)) continue;
        const voiceFrames = Math.ceil((s.audioDurationMs / 1000) * 30);
        const at: Record<string, number> = {
          early: 10,
          mid: s.audioStartFrame + Math.round(voiceFrames * 0.55),
          late: s.durationInFrames - (i === props.scenes.length - 1 ? 2 : props.transitionFrames + 1),
          trans: s.durationInFrames - Math.round(props.transitionFrames / 2),
        };
        // Викторина: середина отсчёта и вердикт; глава — её карточка.
        const special: string[] = [];
        if (s.kind === "quiz" && s.quiz) {
          const q = quizTiming(s);
          at.pause = q.countdownStart + Math.round(q.pauseFrames * 0.4);
          at.reveal = q.revealAt + 24;
          special.push("pause", "reveal");
        }
        if (chapterCardFrames(s, i)) {
          at.card = 30;
          special.push("card");
        }
        // Бренд-заставка — первые полсекунды хука: кадры 2 и 7 поверх первого слова.
        if (v.features && i === 0 && !args.frames) {
          Object.assign(at, { sting2: 2, sting7: 7 });
          special.push("sting2", "sting7");
        }
        for (const m of [...moments, ...special]) {
          if (at[m] === undefined) continue;
          if (m === "trans" && i === props.scenes.length - 1) continue;
          const frame = Math.min(props.durationInFrames - 1, s.startFrame + Math.max(0, at[m]));
          const output = path.join(dir, `${String(i + 1).padStart(2, "0")}-${s.kind}-${m}.png`);
          await renderStill({ serveUrl, composition, inputProps, frame, output, imageFormat: "png", puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });
          count++;
          console.log(`[stills] ${path.relative(OUT_DEV, output)} (кадр ${frame})`);
        }
      }
      if (thumbs) {
        const thumbComp = await selectComposition({ serveUrl, id: "Thumbnail", inputProps, puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });
        const output = path.join(outRoot, `thumbnail-${v.name}.png`);
        await renderStill({ serveUrl, composition: thumbComp, inputProps, frame: 0, output, imageFormat: "png", puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });
        count++;
        console.log(`[stills] ${path.relative(OUT_DEV, output)}`);
      }
    }
  } finally {
    await browser.close({ silent: true });
  }
  console.log(`[stills] готово: ${count} PNG за ${((Date.now() - t0) / 1000).toFixed(1)} с → ${outRoot}`);
}

main().catch((e) => {
  console.error(`[stills] ошибка: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
