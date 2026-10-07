import React, { useMemo } from "react";
import { random } from "remotion";
import { withAlpha, type Theme } from "../theme";

// Декоративная «нейросеть»: узлы на сетке с дрожанием (без комков), связи с
// ближайшими соседями и редкие «вспышки» — импульсы на связях. Детерминирована
// по seed: перерендер даёт ту же картинку. Вокруг текста сеть гаснет (clear),
// чтобы не спорить с надписями.

interface ClearZone {
  cx: number; // центр, px
  cy: number;
  rx: number; // полуоси эллипса, внутри которого сети нет
  ry: number;
  feather: number; // ширина плавного перехода (доля от полуосей)
}

interface Props {
  width: number;
  height: number;
  theme: Theme;
  seed: string;
  cell: number; // шаг сетки узлов, px
  clear?: ClearZone;
  opacity?: number;
  lineWidth?: number;
  nodeSize?: number;
  fireRate?: number; // доля «вспыхнувших» связей
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const NeuralField: React.FC<Props> = ({ width, height, theme, seed, cell, clear, opacity = 1, lineWidth = 2, nodeSize = 5, fireRate = 0.06 }) => {
  const net = useMemo(() => {
    const cols = Math.ceil(width / cell) + 1;
    const rows = Math.ceil(height / cell) + 1;
    const nodes: { x: number; y: number; a: number; r: number; hot: boolean }[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = `${seed}-${i}-${j}`;
        if (random(`${k}-skip`) < 0.18) continue; // дырки — сеть живее, чем решётка
        const x = (i - 0.5 + random(`${k}-x`)) * cell;
        const y = (j - 0.5 + random(`${k}-y`)) * cell;
        let a = 1;
        if (clear) {
          const d = Math.hypot((x - clear.cx) / clear.rx, (y - clear.cy) / clear.ry);
          a = smooth(1, 1 + clear.feather, d);
        }
        if (a <= 0.02) continue;
        nodes.push({ x, y, a, r: nodeSize * (0.6 + random(`${k}-r`) * 0.9), hot: random(`${k}-hot`) < 0.08 });
      }
    }
    // Связи: каждый узел — с 2–3 ближайшими в радиусе ~1.6 клетки.
    const edges: { a: number; b: number; alpha: number; fire: number }[] = [];
    const seen = new Set<string>();
    nodes.forEach((n, i) => {
      const near = nodes
        .map((m, j) => ({ j, d: Math.hypot(m.x - n.x, m.y - n.y) }))
        .filter((o) => o.j !== i && o.d < cell * 1.6)
        .sort((p, q) => p.d - q.d)
        .slice(0, 2 + (random(`${seed}-deg-${i}`) < 0.4 ? 1 : 0));
      for (const o of near) {
        const key = i < o.j ? `${i}:${o.j}` : `${o.j}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const m = nodes[o.j];
        const fade = 1 - o.d / (cell * 1.6);
        const r = random(`${seed}-fire-${key}`);
        edges.push({ a: i, b: o.j, alpha: Math.min(n.a, m.a) * (0.35 + 0.65 * fade), fire: r < fireRate ? 0.2 + random(`${seed}-pos-${key}`) * 0.6 : -1 });
      }
    });
    return { nodes, edges };
  }, [width, height, cell, seed, clear, nodeSize, fireRate]);

  const gid = `nf-${seed.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, opacity }}>
      <defs>
        <radialGradient id={`${gid}-glow`}>
          <stop offset="0%" stopColor={theme.accent} stopOpacity={0.9} />
          <stop offset="30%" stopColor={theme.accent} stopOpacity={0.35} />
          <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${gid}-cool`}>
          <stop offset="0%" stopColor={theme.blobB} stopOpacity={0.55} />
          <stop offset="100%" stopColor={theme.blobB} stopOpacity={0} />
        </radialGradient>
      </defs>
      {net.edges.map((e, i) => {
        const a = net.nodes[e.a];
        const b = net.nodes[e.b];
        return <line key={`e${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={withAlpha(theme.text, 0.22 * e.alpha)} strokeWidth={lineWidth} strokeLinecap="round" />;
      })}
      {/* Импульсы: короткий яркий отрезок на связи + свечение */}
      {net.edges
        .filter((e) => e.fire >= 0)
        .map((e, i) => {
          const a = net.nodes[e.a];
          const b = net.nodes[e.b];
          const t0 = Math.max(0, e.fire - 0.14);
          const t1 = Math.min(1, e.fire + 0.14);
          const px = a.x + (b.x - a.x) * e.fire;
          const py = a.y + (b.y - a.y) * e.fire;
          return (
            <g key={`f${i}`} opacity={e.alpha}>
              <circle cx={px} cy={py} r={cell * 0.22} fill={`url(#${gid}-glow)`} />
              <line
                x1={a.x + (b.x - a.x) * t0}
                y1={a.y + (b.y - a.y) * t0}
                x2={a.x + (b.x - a.x) * t1}
                y2={a.y + (b.y - a.y) * t1}
                stroke={theme.accent}
                strokeWidth={lineWidth * 1.8}
                strokeLinecap="round"
              />
            </g>
          );
        })}
      {net.nodes.map((n, i) => (
        <g key={`n${i}`} opacity={n.a}>
          {n.hot ? <circle cx={n.x} cy={n.y} r={n.r * 5} fill={`url(#${gid}-cool)`} /> : null}
          <circle cx={n.x} cy={n.y} r={n.r} fill={n.hot ? theme.text : withAlpha(theme.text, 0.55)} />
        </g>
      ))}
    </svg>
  );
};
