import { WORLD_110M } from "./world-110m";

// Суша для точечной карты: рёбра всех колец Natural Earth 110m одним массивом
// [lon1, lat1, lon2, lat2, …] и проверка «суша ли» построчно (scanline): для
// широты строки — точки пересечения с рёбрами, между парами — суша (чёт-нечет).
// Так ряд из сотни точек проверяется за один проход по рёбрам, без npm-пакетов.

let edges: Float32Array | null = null;

export function worldEdges(): Float32Array {
  if (edges) return edges;
  const list: number[] = [];
  for (const ring of WORLD_110M.split(";")) {
    const v = ring.split(",").map(Number);
    let x = v[0]!;
    let y = v[1]!;
    const pts: number[] = [x / 10, y / 10];
    for (let i = 2; i + 1 < v.length; i += 2) {
      x += v[i]!;
      y += v[i + 1]!;
      pts.push(x / 10, y / 10);
    }
    for (let i = 0; i + 3 < pts.length; i += 2) list.push(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!);
    // Замыкаем кольцо, если последняя точка не совпала с первой.
    const n = pts.length;
    if (pts[0] !== pts[n - 2] || pts[1] !== pts[n - 1]) list.push(pts[n - 2]!, pts[n - 1]!, pts[0]!, pts[1]!);
  }
  edges = Float32Array.from(list);
  return edges;
}

// Отрезки долгот суши на широте lat (отсортированы, [from, to] попарно).
export function landSpans(lat: number): number[] {
  const e = worldEdges();
  const xs: number[] = [];
  for (let i = 0; i < e.length; i += 4) {
    const y1 = e[i + 1]!;
    const y2 = e[i + 3]!;
    // Полуоткрытый интервал: вершина на самой строке не считается дважды.
    if (y1 <= lat === y2 <= lat) continue;
    const x1 = e[i]!;
    const x2 = e[i + 2]!;
    xs.push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1));
  }
  return xs.sort((a, b) => a - b);
}

export function isLand(spans: number[], lon: number): boolean {
  // Долгота за пределами ±180 (камера у линии перемены дат) — заворачиваем.
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  let inside = false;
  for (let i = 0; i < spans.length; i++) {
    if (spans[i]! > x) break;
    inside = !inside;
  }
  return inside;
}

// «59,94° с. ш., 30,31° в. д.» — подпись координат по-русски.
export function formatLatLon(lat: number, lon: number): string {
  const f = (v: number) => Math.abs(v).toFixed(2).replace(".", ",");
  return `${f(lat)}° ${lat >= 0 ? "с." : "ю."} ш., ${f(lon)}° ${lon >= 0 ? "в." : "з."} д.`;
}
