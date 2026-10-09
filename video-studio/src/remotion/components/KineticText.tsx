import React, { useMemo } from "react";
import { Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { RenderScene } from "../../types";
import { countFrames, formatLike, numberInfo } from "../lib/numbers";
import { fitTokens, parseMarkup, type FontSpec, type TextRun, type TextToken } from "../lib/text";
import { accentFrame, scheduleTokens } from "../lib/timing";
import { withAlpha, type Theme } from "../theme";

// Кинетическая типографика: слова влетают по одному на пружине, акцентные
// (*слово*) — цветом темы с маркером/подчёркиванием, которое «прорисовывается»
// в момент, когда диктор произносит это слово. Кегль подбирается так, чтобы
// любой реалистичный onScreen (~60 символов) влез в отведённую коробку.

// rise    — слово выезжает снизу из-под «маски» строки (редакционная подача);
// pop     — слово «впечатывается»: короткий чёткий масштаб без размытия;
// fade    — мягкое проявление с небольшим подъёмом;
// karaoke — весь текст сразу виден приглушённым, слово «загорается», когда
//           его произносят (для цитат: экран не пустой, ритм — по голосу).
export type Entrance = "rise" | "pop" | "fade" | "karaoke";
export type Highlight = "marker" | "underline" | "color";

export interface KineticTextProps {
  text: string;
  theme: Theme;
  box: { w: number; h: number };
  font: FontSpec;
  maxFontSize: number;
  minFontSize?: number;
  maxLines?: number;
  align?: "left" | "center";
  scene?: Pick<RenderScene, "audioStartFrame" | "words" | "audioDurationMs">;
  mode?: "stagger" | "speech";
  start?: number; // кадр (от начала сцены) первого слова
  step?: number; // шаг между словами в режиме stagger
  deadline?: number; // speech: всё видно не позже этого кадра
  entrance?: Entrance;
  highlight?: Highlight;
  highlightAt?: number;
  color?: string;
  shadow?: boolean;
  firstAt?: number; // первое слово не позже этого кадра (хук: кадр 0 не пустой)
  impact?: number; // «удар» блока при появлении каждого слова (0..1), для pop
  dim?: number; // karaoke: непрозрачность ещё не произнесённых слов
  numbers?: boolean; // числа в тексте подсвечиваются и докручиваются (по умолчанию да)
}

export function useFittedTokens(text: string, font: FontSpec, box: { w: number; h: number }, maxFontSize: number, minFontSize?: number, maxLines?: number) {
  const tokens = useMemo(() => parseMarkup(text), [text]);
  const fit = useMemo(
    () => fitTokens(tokens, font, box, { maxFontSize, minFontSize, maxLines }),
    // font — объект-литерал у вызывающего, сравниваем по значениям
    [tokens, font.fontFamily, font.fontWeight, font.letterSpacingEm, font.lineHeight, font.uppercase, box.w, box.h, maxFontSize, minFontSize, maxLines],
  );
  return { tokens, fit };
}

export const KineticText: React.FC<KineticTextProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Маркер выступает за слово на ~0.12em с каждой стороны — резервируем место,
  // чтобы он не залезал в правую зону интерфейса Shorts.
  const reserve = (p.highlight ?? "underline") === "marker" && /\*/.test(p.text) ? p.maxFontSize * 0.26 : 0;
  const box = useMemo(() => ({ w: Math.max(50, p.box.w - reserve), h: p.box.h }), [p.box.w, p.box.h, reserve]);
  const { tokens, fit } = useFittedTokens(p.text, p.font, box, p.maxFontSize, p.minFontSize, p.maxLines);
  const start = p.start ?? 4;
  const step = p.step ?? 3;
  const appear = useMemo(() => {
    const base = p.scene
      ? scheduleTokens(tokens, p.scene, fps, {
          mode: p.mode ?? "stagger",
          start,
          step,
          deadline: p.deadline,
        })
      : tokens.map((_, i) => start + i * step);
    if (p.firstAt !== undefined && base.length > 0) base[0] = Math.min(base[0], p.firstAt);
    return base;
  }, [tokens, p.scene, fps, p.mode, start, step, p.deadline, p.firstAt]);
  const lastAppear = appear.length ? appear[appear.length - 1] : start;
  const hlAt = useMemo(() => {
    if (p.highlightAt !== undefined) return p.highlightAt;
    const fallback = lastAppear + 8;
    const spoken = p.scene ? accentFrame(tokens, p.scene, fps, fallback) : fallback;
    // Подсветка не раньше, чем слово появилось на экране.
    const tokenIdx = tokens.findIndex((t) => t.accent);
    const own = tokenIdx >= 0 ? appear[tokenIdx] + 6 : fallback;
    return Math.max(spoken, own);
  }, [p.highlightAt, p.scene, tokens, fps, appear, lastAppear]);

  const fs = fit.fontSize;
  const lh = fs * p.font.lineHeight;
  const align = p.align ?? "center";
  const color = p.color ?? p.theme.text;
  const entrance = p.entrance ?? "rise";
  const karaokeIn =
    entrance === "karaoke"
      ? interpolate(frame, [start - 10, start], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  // «Удар»: каждое новое слово чуть толкает весь блок — короткий затухающий
  // масштаб. Считаем от последнего появившегося слова.
  let impactScale = 1;
  if (p.impact) {
    let lastHit = -Infinity;
    for (const a of appear) if (a <= frame && a > lastHit) lastHit = a;
    const dt = frame - lastHit;
    if (dt >= 0 && dt < 12) impactScale = 1 + p.impact * 0.022 * Math.exp(-dt / 2.2) * Math.cos(dt * 0.9);
  }

  return (
    <div
      style={{
        width: Math.ceil(Math.max(...fit.lineWidths, 1)) + 2,
        fontFamily: p.font.fontFamily,
        fontWeight: p.font.fontWeight,
        fontSize: fs,
        lineHeight: `${lh}px`,
        letterSpacing: p.font.letterSpacingEm ? `${p.font.letterSpacingEm}em` : undefined,
        textTransform: p.font.uppercase ? "uppercase" : undefined,
        color,
        textAlign: align,
        transform: impactScale !== 1 ? `scale(${impactScale})` : undefined,
        opacity: karaokeIn,
      }}
    >
      {fit.lines.map((line, li) => {
        // Маска строки для rise: слово выезжает из-под нижнего края строки.
        // Маску снимаем, когда все слова строки доехали, — иначе она
        // обрезала бы свечение маркера и «подпрыгивание» акцента.
        const lineDone = line.every((ti) => frame >= appear[ti] + RISE_FRAMES);
        const masked = entrance === "rise" && !lineDone;
        return (
          <div
            key={li}
            style={{
              whiteSpace: "nowrap",
              height: lh,
              clipPath: masked ? "inset(-1em -1em -0.14em -1em)" : undefined,
            }}
          >
            {line.map((ti, j) => (
              <React.Fragment key={ti}>
                {j > 0 ? " " : null}
                <Word
                  token={tokens[ti]}
                  appearAt={appear[ti]}
                  frame={frame}
                  fps={fps}
                  theme={p.theme}
                  entrance={entrance}
                  highlight={p.highlight ?? "underline"}
                  highlightAt={hlAt}
                  fontSize={fs}
                  color={color}
                  shadow={p.shadow !== false}
                  dim={p.dim ?? 0.24}
                  numbers={p.numbers !== false}
                />
              </React.Fragment>
            ))}
          </div>
        );
      })}
    </div>
  );
};

// Пока число бежит, его ширина меняется: держим место под итоговое значение
// (невидимая копия), а бегущие цифры рисуем поверх по центру — соседние слова
// и переносы строк не дёргаются.
const CountBox: React.FC<{ final: string; shown: string }> = ({ final, shown }) => (
  <span style={{ position: "relative", display: "inline-block" }}>
    <span style={{ visibility: "hidden" }}>{final}</span>
    <span style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>{shown}</span>
  </span>
);

// Число в слове («84%», «≈28 000»): цвет акцента и счёт от нуля, пока слово
// появляется; в конце — короткий «толчок» (pop 0..1). Годы, дроби и мелкие
// целые — только подсветка; акцентное слово (*…*) сохраняет свой стиль, у
// него только счёт. null — в слове нет числа. Берут и пункты списка.
export function numberRender(
  token: TextToken,
  o: { frame: number; appearAt: number; counting: boolean; theme: Theme; fontSize: number; shadow?: string },
): { render: (run: TextRun) => React.ReactNode; pop: number } | null {
  const num = numberInfo(token.text);
  if (!num) return null;
  const start = o.appearAt + 2;
  const len = countFrames(num.value);
  const counting = num.count && o.counting;
  const k = counting ? interpolate(o.frame, [start, start + len], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }) : 1;
  const pop = token.accent ? 0 : interpolate(o.frame - (counting ? start + len : o.appearAt + 4), [0, 9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const style: React.CSSProperties | undefined = token.accent
    ? undefined
    : { color: o.theme.accent, textShadow: `0 0 ${o.fontSize * 0.32}px ${withAlpha(o.theme.accent, 0.42)}${o.shadow ? `, ${o.shadow}` : ""}` };
  const offsets = new Map<TextRun, number>();
  token.runs.reduce((acc, r) => (offsets.set(r, acc), acc + r.text.length), 0);
  const render = (run: TextRun): React.ReactNode => {
    const text = run.text;
    const offset = offsets.get(run) ?? 0;
    const ns = num.start - offset;
    const ne = ns + num.raw.length;
    if (ns < 0 || ne > text.length) return text; // число разрезано разметкой — без анимации
    const a = Math.max(0, num.hlStart - offset);
    const b = Math.min(text.length, num.hlEnd - offset);
    const digits = k >= 1 ? num.raw : <CountBox final={num.raw} shown={formatLike(num, num.value * k)} />;
    return (
      <>
        {text.slice(0, a)}
        <span style={style}>
          {text.slice(a, ns)}
          {digits}
          {text.slice(ne, b)}
        </span>
        {text.slice(b)}
      </>
    );
  };
  return { render, pop };
}

const RISE_FRAMES = 12;
const riseEase = Easing.bezier(0.16, 1, 0.3, 1); // easeOutExpo-подобная: быстрый старт, мягкая посадка
const popEase = Easing.bezier(0.2, 0.9, 0.25, 1);

const Word: React.FC<{
  token: TextToken;
  appearAt: number;
  frame: number;
  fps: number;
  theme: Theme;
  entrance: Entrance;
  highlight: Highlight;
  highlightAt: number;
  fontSize: number;
  color: string;
  shadow: boolean;
  dim: number;
  numbers: boolean;
}> = ({ token, appearAt, frame, fps, theme, entrance, highlight, highlightAt, fontSize, color, shadow, dim, numbers }) => {
  const local = frame - appearAt;
  const clamp = {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const;
  let transform = "";
  let opacity = 1;
  if (entrance === "pop") {
    // Чёткое «впечатывание»: 2 кадра на проявление, 6 — на посадку масштаба.
    // Без blur и без большого стартового масштаба — иначе в первых кадрах
    // висит размытый «призрак» слова.
    opacity = interpolate(local, [0, 2], [0, 1], clamp);
    const k = interpolate(local, [0, 6], [0, 1], { ...clamp, easing: popEase });
    transform = `scale(${interpolate(k, [0, 1], [1.16, 1])})`;
  } else if (entrance === "fade") {
    const s = spring({
      frame: local,
      fps,
      config: { damping: 200 },
      durationInFrames: 16,
    });
    opacity = interpolate(local, [0, 10], [0, 1], clamp);
    transform = `translateY(${interpolate(s, [0, 1], [0.22, 0])}em)`;
  } else if (entrance === "karaoke") {
    const k = interpolate(local, [0, 7], [0, 1], {
      ...clamp,
      easing: riseEase,
    });
    opacity = dim + (1 - dim) * k;
    transform = `translateY(${interpolate(k, [0, 1], [0.06, 0])}em)`;
  } else {
    const k = interpolate(local, [0, RISE_FRAMES], [0, 1], {
      ...clamp,
      easing: riseEase,
    });
    opacity = interpolate(local, [0, 4], [0, 1], clamp);
    transform = `translateY(${interpolate(k, [0, 1], [1.05, 0])}em)`;
  }

  const hl = token.accent
    ? spring({
        frame: frame - highlightAt,
        fps,
        config: { damping: 18, stiffness: 160, mass: 0.6 },
      })
    : 0;
  const shine = token.accent ? interpolate(frame - highlightAt, [10, 26], [0, 1], clamp) : 0;
  const baseShadow = shadow ? `0 ${fontSize * 0.04}px ${fontSize * 0.18}px rgba(0,0,0,0.38)` : undefined;

  const nums = numbers
    ? numberRender(token, { frame, appearAt, counting: entrance !== "karaoke", theme, fontSize, shadow: baseShadow })
    : null;
  const numPop = nums?.pop ?? 0;

  const renderRuns = (accentColor: string, runs = token.runs) =>
    runs.map((r, i) => (
      <span key={i} style={r.accent ? { color: accentColor } : undefined}>
        {nums ? nums.render(r) : r.text}
      </span>
    ));
  // Маркер/подчёркивание — только под самим словом: пунктуация по краям
  // («*Подпишись*,», «*Неделя.*») остаётся снаружи, обычным цветом.
  const isPunct = (t: string) => !/[\p{L}\p{N}]/u.test(t);
  let a = 0;
  let b = token.runs.length;
  while (a < b - 1 && isPunct(token.runs[a].text)) a++;
  while (b - 1 > a && isPunct(token.runs[b - 1].text)) b--;
  const core = token.runs.slice(a, b);
  const edge = (runs: TextRun[]) => (runs.length ? <span style={{ color, textShadow: baseShadow }}>{runs.map((r) => r.text).join("")}</span> : null);
  const lead = edge(token.runs.slice(0, a));
  const trail = edge(token.runs.slice(b));

  let inner: React.ReactNode;
  if (token.accent && highlight === "marker") {
    const ink = interpolateColors(hl, [0.35, 0.75], [theme.accent, theme.accentInk]);
    inner = (
      <>
        {lead}
        <span style={{ position: "relative", display: "inline-block" }}>
          <span
            style={{
              position: "absolute",
              left: "-0.12em",
              right: "-0.12em",
              top: "0.04em",
              bottom: "0.02em",
              borderRadius: "0.14em",
              background: `linear-gradient(100deg, ${theme.accent} 0%, ${theme.accent2} 140%)`,
              transform: `scaleX(${hl}) rotate(-1.2deg)`,
              transformOrigin: "0% 50%",
              boxShadow: hl > 0.05 ? `0 ${fontSize * 0.06}px ${fontSize * 0.3}px ${withAlpha(theme.accent, 0.35)}` : undefined,
              overflow: "hidden",
            }}
          >
            {/* Блик пробегает по маркеру один раз, когда тот дорисовался */}
            {shine > 0 && shine < 1 ? (
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  width: "40%",
                  left: `${-40 + shine * 160}%`,
                  background: "linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)",
                }}
              />
            ) : null}
          </span>
          <span
            style={{
              position: "relative",
              textShadow: hl > 0.5 ? "none" : baseShadow,
            }}
          >
            {renderRuns(ink, core)}
          </span>
        </span>
        {trail}
      </>
    );
  } else if (token.accent && highlight === "underline") {
    inner = (
      <>
        {lead}
        <span style={{ position: "relative", display: "inline-block" }}>
          <span
            style={{
              position: "relative",
              textShadow: `0 0 ${fontSize * 0.35}px ${withAlpha(theme.accent, 0.45 * Math.min(1, hl + 0.3))}, ${baseShadow ?? "0 0 0 transparent"}`,
            }}
          >
            {renderRuns(theme.accent, core)}
          </span>
          <span
            style={{
              position: "absolute",
              left: "0.02em",
              right: "0.02em",
              bottom: "0.02em",
              height: "0.1em",
              borderRadius: "0.05em",
              background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
              transform: `scaleX(${hl})`,
              transformOrigin: "0% 50%",
            }}
          />
        </span>
        {trail}
      </>
    );
  } else {
    inner = (
      <span
        style={{
          textShadow: token.accent ? `0 0 ${fontSize * 0.35}px ${withAlpha(theme.accent, 0.4)}` : baseShadow,
        }}
      >
        {renderRuns(token.accent ? theme.accent : color)}
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-block",
        position: "relative",
        transform,
        transformOrigin: "50% 100%",
        opacity,
        // Пружина акцента слегка «подпрыгивает» слово в момент произнесения;
        // число — когда докрутилось.
        scale: token.accent
          ? String(1 + 0.06 * Math.sin(Math.min(1, Math.max(0, hl)) * Math.PI))
          : numPop > 0 && numPop < 1
            ? String(1 + 0.08 * Math.sin(numPop * Math.PI))
            : undefined,
      }}
    >
      {inner}
    </span>
  );
};
