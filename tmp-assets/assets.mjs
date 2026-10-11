// Временный: ассеты для приглашения — образы Gemini (лицо как на фото) и видео Pixabay.
import fs from "node:fs";
import path from "node:path";
const OUT = process.env.OUT_DIR;
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "); console.log(s); fs.appendFileSync(path.join(OUT, "log.txt"), s + "\n"); };
const G = process.env.GEMINI_API_KEY, P = process.env.PIXABAY_API_KEY;
const BASE = "https://generativelanguage.googleapis.com/v1beta";
async function j(url, init) { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(180000) }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { ok: r.ok, status: r.status, b }; }

// 1) Gemini: модели с выводом изображений.
const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "prompts.json"), "utf8"));
const photoFile = path.join(path.dirname(new URL(import.meta.url).pathname), "photo.jpg");
const photo = fs.existsSync(photoFile) ? fs.readFileSync(photoFile).toString("base64") : null;
let models = [];
if (G) {
  const m = await j(`${BASE}/models?pageSize=200&key=${G}`);
  models = (m.b.models ?? []).filter((x) => /image/i.test(x.name) && !/imagen/i.test(x.name) && (x.supportedGenerationMethods ?? []).includes("generateContent")).map((x) => x.name.replace(/^models\//, ""));
  const score = (n) => (/pro/.test(n) ? 20 : 0) + (/preview|exp/.test(n) ? 0 : 5) + Number((n.match(/(\d+)\.(\d+)/) ?? [0, 0, 0]).slice(1).join("."));
  models.sort((a, b) => score(b) - score(a));
  log("image models:", models);
}
for (const it of cfg.items) {
  if (!G || !models.length || !photo) break;
  const text = cfg.keep + it.text + (it.bgOverride ?? cfg.bg);
  let done = false;
  for (const model of models.slice(0, 3)) {
    for (const withCfg of [true, false]) {
      const body = { contents: [{ parts: [{ inline_data: { mime_type: "image/jpeg", data: photo } }, { text }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(withCfg ? { imageConfig: { aspectRatio: "9:16" } } : {}) } };
      const r = await j(`${BASE}/models/${model}:generateContent?key=${G}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const parts = r.b?.candidates?.[0]?.content?.parts ?? [];
      const img = parts.find((p) => p.inlineData || p.inline_data);
      if (r.ok && img) {
        const d = img.inlineData ?? img.inline_data;
        const ext = /png/.test(d.mimeType ?? d.mime_type ?? "") ? "png" : "jpg";
        fs.writeFileSync(path.join(OUT, `${it.id}.${ext}`), Buffer.from(d.data, "base64"));
        log(`${it.id}: ok via ${model} cfg=${withCfg}`, parts.filter((p) => p.text).map((p) => p.text).join(" ").slice(0, 200));
        done = true;
        break;
      }
      log(`${it.id}: ${model} cfg=${withCfg} → HTTP ${r.status}`, JSON.stringify(r.b?.error ?? r.b?.candidates?.[0]?.finishReason ?? r.b?.promptFeedback ?? "").slice(0, 400));
      if (r.status === 429 || r.status === 403) break; // квота/доступ — к следующей модели
    }
    if (done) break;
  }
}

// 2) Pixabay: ещё силуэт головы коня и узоры — картинки.
// 2) Pixabay: видео коней и беркута (лицензия Pixabay — без указания автора).
if (P) {
  const want = [["eagle flying green screen", 4], ["flying eagle green screen loop", 3], ["golden eagle green screen", 3], ["hawk flying green screen", 3], ["falcon green screen", 2], ["bird flying green screen", 3]];
  for (const [q, n] of want) {
    const r = await j(`https://pixabay.com/api/videos/?key=${P}&q=${encodeURIComponent(q)}&per_page=10&safesearch=true`);
    const hits = r.b?.hits ?? [];
    log(`pixabay "${q}": ${hits.length}`, hits.slice(0, 6).map((h) => ({ id: h.id, tags: h.tags, dur: h.duration, w: h.videos?.medium?.width, h: h.videos?.medium?.height })));
    for (const h of hits.slice(0, n)) {
      const v = h.videos?.medium?.url ? h.videos.medium : h.videos?.small;
      if (!v?.url) continue;
      const res = await fetch(v.url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) { log("dl fail", h.id, res.status); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 25e6) { log("skip big", h.id, buf.length); continue; }
      fs.writeFileSync(path.join(OUT, `px-${q.replace(/\s+/g, "-")}-${h.id}.mp4`), buf);
      log("saved", h.id, h.tags, buf.length);
    }
  }
}
log("done");
