// Dev: пересобрать контур суши для карт в роликах (src/remotion/map/world-110m.ts)
// из Natural Earth 1:110m land — общественное достояние, https://www.naturalearthdata.com
// (файл ne_110m_land.geojson из github.com/nvkelso/natural-earth-vector).
//
//   npx tsx src/dev/world-map.ts                    скачать и пересобрать
//   npx tsx src/dev/world-map.ts путь/к/файлу.geojson
//
// Координаты округляются до 0,1°, кольца кодируются разностями целых чисел —
// ~30 КБ в бандле вместо ~130 КБ GeoJSON, без npm-пакетов и сети при рендере.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./devRender";

const URL_110M = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson";
const OUT = path.join(ROOT, "src", "remotion", "map", "world-110m.ts");

type Ring = [number, number][];
interface Geo {
  features: { geometry: { type: "Polygon" | "MultiPolygon"; coordinates: Ring[] | Ring[][] } }[];
}

async function load(src: string | undefined): Promise<Geo> {
  if (src) return JSON.parse(fs.readFileSync(src, "utf8")) as Geo;
  const res = await fetch(URL_110M, { signal: AbortSignal.timeout(60_000), headers: { "User-Agent": "video-studio/0.1 (+https://github.com/Magamed56/yt-planner)" } });
  if (!res.ok) throw new Error(`Natural Earth: HTTP ${res.status}`);
  return (await res.json()) as Geo;
}

// Кольцо → «x,y,dx,dy,…» в десятых долях градуса; подряд одинаковые точки выкидываем.
function encodeRing(ring: Ring): string | null {
  const pts: [number, number][] = [];
  for (const [lon, lat] of ring) {
    const p: [number, number] = [Math.round(lon * 10), Math.round(lat * 10)];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  if (pts.length < 4) return null;
  const out: number[] = [pts[0]![0], pts[0]![1]];
  for (let i = 1; i < pts.length; i++) out.push(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return out.join(",");
}

const geo = await load(process.argv[2]);
const rings: string[] = [];
for (const f of geo.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates as Ring[]] : (f.geometry.coordinates as Ring[][]);
  for (const poly of polys) for (const ring of poly) {
    const enc = encodeRing(ring);
    if (enc) rings.push(enc);
  }
}
const body = `// Суша Земли для карт в роликах: Natural Earth 1:110m land (общественное достояние,
// https://www.naturalearthdata.com — «Made with Natural Earth»). Сгенерировано
// src/dev/world-map.ts: кольца через «;», в каждом — x,y первой точки и
// разности следующих, в десятых долях градуса (долгота, широта).
export const WORLD_110M =
  "${rings.join(";")}";
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
console.log(`[world-map] ${rings.length} колец, ${(body.length / 1024).toFixed(1)} КБ → ${path.relative(ROOT, OUT)}`);
