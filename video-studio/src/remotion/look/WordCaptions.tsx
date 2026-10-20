import React, { useMemo } from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { measureText } from "@remotion/layout-utils";
import type { RenderScene, TimelineCaption } from "../../types";
import { FONT_DISPLAY } from "../fonts";
import { sceneBreaksMs } from "../lib/caption-pages";
import { useLayout } from "../lib/layout";

// Субтитры подачи bright: по одному слову крупно по центру кадра — белые с
// толстой чёрной обводкой. Короткое служебное слово («в», «не», «для») идёт
// вместе со следующим, иначе мелькает. Акцентное слово сцены (*слово* в onScreen)
// и числа — жёлтые. Слово висит до начала следующего: без пустых кадров внутри сцены.

const YELLOW = "#ffe14d";
const HOLD_MS = 280; // после последнего слова сцены
const MAX_JOIN_GAP_MS = 650; // дольше пауза — слово гаснет, а не висит
const FONT_WEIGHT = 900;

interface Group {
  text: string;
  startMs: number;
  endMs: number;
  accent: boolean;
  scene: number; // индекс сцены
}

// Сцена на кадре (BrightScene) — слово выше, по центру картинки; сцена в обычной
// раскладке (финал, сцена без кадра) — на месте обычных субтитров, под её текстом.
const onPicture = (s: RenderScene | undefined) => !!s && s.kind !== "cta" && s.visual.type !== "none";

const letters = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
const clean = (s: string) => s.trim().replace(/[.,;:—–-]+$/u, "").replace(/^[«"„(]+|[»"”)]+$/gu, "");

function accentStems(scene: RenderScene): string[] {
  const m = scene.onScreen.match(/\*([^*]+)\*/);
  if (!m) return [];
  return m[1]!
    .split(/\s+/)
    .map(letters)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, Math.min(5, w.length)));
}

function buildGroups(captions: TimelineCaption[], scenes: RenderScene[]): Group[] {
  const breaks = sceneBreaksMs(scenes);
  const sceneOf = (ms: number) => breaks.filter((b) => ms >= b).length;
  const stems = scenes.map(accentStems);
  const out: Group[] = [];
  let cur: (Group & { words: number; scene: number; allShort: boolean }) | null = null;
  const flush = () => {
    if (cur) out.push({ text: cur.text, startMs: cur.startMs, endMs: cur.endMs, accent: cur.accent, scene: cur.scene });
    cur = null;
  };
  for (const c of captions) {
    const word = clean(c.text);
    if (!word) continue;
    const sc = sceneOf(c.startMs);
    const l = letters(word);
    const accent = /\d/.test(word) || (stems[sc] ?? []).some((s) => l.startsWith(s));
    // Пока в группе только короткие слова («и не для») — копим до первого полного слова.
    if (cur && cur.scene === sc && cur.allShort && cur.words < 4 && c.startMs - cur.endMs < MAX_JOIN_GAP_MS) {
      cur.text += ` ${word}`;
      cur.endMs = c.endMs;
      cur.words++;
      cur.accent ||= accent;
      cur.allShort = l.length <= 3;
      continue;
    }
    flush();
    cur = { text: word, startMs: c.startMs, endMs: c.endMs, accent, words: 1, scene: sc, allShort: l.length <= 3 };
  }
  flush();
  return out;
}

export const WordCaptions: React.FC<{ captions: TimelineCaption[]; scenes: RenderScene[] }> = ({ captions, scenes }) => {
  const { fps, width, height } = useVideoConfig();
  const layout = useLayout();
  const groups = useMemo(() => buildGroups(captions, scenes), [captions, scenes]);
  const breaks = useMemo(() => sceneBreaksMs(scenes), [scenes]);
  return (
    <>
      {groups.map((g, i) => {
        const next = groups[i + 1];
        const sameScene = next && breaks.filter((b) => g.startMs >= b).length === breaks.filter((b) => next.startMs >= b).length;
        const endMs = next && sameScene && next.startMs - g.endMs < MAX_JOIN_GAP_MS ? next.startMs : Math.min(next?.startMs ?? Infinity, g.endMs + HOLD_MS);
        const from = Math.round((g.startMs / 1000) * fps);
        const dur = Math.max(1, Math.round((endMs / 1000) * fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none" name={`Слово ${i + 1}`}>
            <Word group={g} width={width} centerY={onPicture(scenes[g.scene]) ? Math.round(height * 0.655) : layout.captions.centerY} />
          </Sequence>
        );
      })}
    </>
  );
};

const Word: React.FC<{ group: Group; width: number; centerY: number }> = ({ group, width, centerY }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const unit = width / 1080;
  const maxW = width * 0.8;
  let fs = Math.round(124 * unit);
  const w = measureText({ text: group.text, fontFamily: FONT_DISPLAY, fontSize: fs, fontWeight: FONT_WEIGHT, letterSpacing: "0px" }).width;
  if (w > maxW) fs = Math.max(Math.round(64 * unit), Math.floor((fs * maxW) / w));
  const pop = spring({ frame, fps, config: { damping: 10, stiffness: 320, mass: 0.45 } });
  const parts: string[] = [];
  const px = Math.max(4, fs * 0.085);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    parts.push(`${(Math.cos(a) * px).toFixed(1)}px ${(Math.sin(a) * px).toFixed(1)}px 0 #000`);
  }
  parts.push(`0 ${px * 1.4}px ${px * 2.6}px rgba(0,0,0,0.55)`);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          width,
          top: centerY,
          transform: `translateY(-50%) scale(${interpolate(pop, [0, 1], [0.72, 1]).toFixed(4)})`,
          textAlign: "center",
          fontFamily: FONT_DISPLAY,
          fontWeight: FONT_WEIGHT,
          fontSize: fs,
          lineHeight: 1.1,
          color: group.accent ? YELLOW : "#fff",
          textShadow: parts.join(", "),
          whiteSpace: "nowrap",
        }}
      >
        {group.text}
      </div>
    </AbsoluteFill>
  );
};
