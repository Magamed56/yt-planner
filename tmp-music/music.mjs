// Временный: поиск свободной инструментальной музыки (Openverse: Jamendo, Freesound, Wikimedia).
import fs from "node:fs";
import path from "node:path";
const OUT = process.env.OUT_DIR;
fs.mkdirSync(OUT, { recursive: true });
const log = (s) => { console.log(s); fs.appendFileSync(path.join(OUT, "log.txt"), s + "\n"); };
const qs = fs.readFileSync(new URL("./queries.txt", import.meta.url), "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const seen = new Map();
for (const q of qs) {
  const url = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&page_size=20&license_type=commercial,modification&mature=false`;
  const r = await fetch(url, { headers: { "user-agent": "yt-planner-invite/1.0" }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) { log(`q="${q}" HTTP ${r.status}`); continue; }
  const b = await r.json();
  log(`q="${q}": ${b.result_count} results`);
  for (const it of b.results ?? []) {
    if (seen.has(it.id)) continue;
    const dur = Math.round((it.duration ?? 0) / 1000);
    seen.set(it.id, { q, id: it.id, title: it.title, creator: it.creator, license: `${it.license} ${it.license_version ?? ""}`.trim(), source: it.source, provider: it.provider, dur, genres: it.genres, tags: (it.tags ?? []).map((t) => t.name).slice(0, 12), url: it.url, page: it.foreign_landing_url, ext: it.filetype });
  }
}
const all = [...seen.values()];
fs.writeFileSync(path.join(OUT, "candidates.json"), JSON.stringify(all, null, 1));
// Скачиваем подходящие по длине (25–400 с), до 14 файлов.
const pick = all.filter((x) => x.dur >= 25 && x.dur <= 400 && x.url).slice(0, 14);
for (const x of pick) {
  try {
    const r = await fetch(x.url, { signal: AbortSignal.timeout(90000) });
    if (!r.ok) { log(`dl ${x.id} HTTP ${r.status}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 15e6) { log(`skip big ${x.id}`); continue; }
    const ext = (x.ext || path.extname(new URL(x.url).pathname).slice(1) || "mp3").replace(/[^a-z0-9]/gi, "");
    fs.writeFileSync(path.join(OUT, `${x.id}.${ext}`), buf);
    log(`saved ${x.id}.${ext} | ${x.title} | ${x.creator} | ${x.license} | ${x.provider} | ${x.dur}s | ${x.tags.join(",")}`);
  } catch (e) { log(`dl ${x.id} error ${e}`); }
}
log("done");
