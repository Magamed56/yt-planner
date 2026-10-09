import { createTikTokStyleCaptions, type Caption, type TikTokPage } from "@remotion/captions";
import { FPS, type TimelineCaption } from "../../types";

// Страницы субтитров в стиле TikTok (~1 с речи). Без React и DOM — проверяется
// в Node (src/dev/media-test.ts).

const COMBINE_MS = 1000;
const BREAK_ON_SILENCE_MS = 300; // пауза между предложениями — новая страница

type SceneVoice = { startFrame: number; audioStartFrame: number; audioDurationMs: number };

// Страницы режем отдельно по сценам: пауза между репликами соседних сцен
// (≈ 0,2 с, types.ts) короче BREAK_ON_SILENCE_MS, и иначе конец одной сцены
// и начало следующей попадали бы на одну страницу, висящую через склейку.
export function captionPages(captions: TimelineCaption[], scenes: SceneVoice[] = []): TikTokPage[] {
  // Граница — середина паузы между голосами соседних сцен (голоса не
  // перекрываются, их раскладывает layoutScenes).
  const voiceStart = (s: SceneVoice) => ((s.startFrame + s.audioStartFrame) / FPS) * 1000;
  const breaks = scenes.slice(1).map((s, i) => (voiceStart(scenes[i]!) + scenes[i]!.audioDurationMs + voiceStart(s)) / 2);
  const groups: TimelineCaption[][] = [[]];
  let b = 0;
  for (const c of captions) {
    let crossed = false;
    while (b < breaks.length && c.startMs >= breaks[b]!) {
      b++;
      crossed = true;
    }
    if (crossed && groups.at(-1)!.length) groups.push([]);
    groups.at(-1)!.push(c);
  }
  return groups
    .filter((g) => g.length > 0)
    .flatMap((g) => {
      // Ведущий пробел у всех слов, кроме первого, — по нему
      // createTikTokStyleCaptions понимает границы слов.
      const prepared: Caption[] = g.map((c, i) => ({
        ...c,
        text: i === 0 ? c.text.trimStart() : c.text.startsWith(" ") ? c.text : ` ${c.text}`,
      }));
      return createTikTokStyleCaptions({ captions: prepared, combineTokensWithinMilliseconds: COMBINE_MS, breakOnSilenceAfterMilliseconds: BREAK_ON_SILENCE_MS }).pages;
    });
}
