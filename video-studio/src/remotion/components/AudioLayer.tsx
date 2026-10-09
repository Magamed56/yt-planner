import React, { useMemo } from "react";
import { Html5Audio, Sequence, useVideoConfig } from "remotion";
import type { RenderScene, VideoProps } from "../../types";
import { sceneCues } from "../lib/cues";
import { resolveSrc } from "./MediaLayer";

// Весь звук ролика — отдельным слоем ВНЕ TransitionSeries, на абсолютных
// кадрах из props: так голос стоит ровно там, где его посчитал layoutScenes().

const DUCK_RAMP_SEC = 0.25;
const FADE_IN_SEC = 0.5;
const FADE_OUT_SEC = 1.5;
const WHOOSH_LEAD_FRAMES = 4; // свист начинается чуть раньше склейки — пик звука приходится на переход

export function voiceIntervals(scenes: RenderScene[], fps: number): [number, number][] {
  return scenes
    .filter((s) => s.audioDurationMs > 0)
    .map((s) => {
      const start = s.startFrame + s.audioStartFrame;
      return [start, start + (s.audioDurationMs / 1000) * fps] as [number, number];
    });
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

// Громкость музыки по кадру: приглушение под голосом с плавными рампами,
// fade-in в начале и fade-out в конце. Считаем массив один раз.
export function buildMusicVolumes(
  total: number,
  intervals: [number, number][],
  fps: number,
  volume: number,
  ducked: number,
): Float32Array {
  const ramp = Math.max(1, DUCK_RAMP_SEC * fps);
  const fadeIn = Math.max(1, FADE_IN_SEC * fps);
  const fadeOut = Math.max(1, FADE_OUT_SEC * fps);
  const out = new Float32Array(Math.max(1, total));
  for (let f = 0; f < out.length; f++) {
    let duck = 0;
    for (const [s, e] of intervals) {
      if (f < s - ramp || f > e + ramp) continue;
      const d = f < s ? smooth((f - (s - ramp)) / ramp) : f > e ? smooth(1 - (f - e) / ramp) : 1;
      if (d > duck) duck = d;
      if (duck >= 1) break;
    }
    const base = volume + (ducked - volume) * duck;
    const env = Math.min(smooth(f / fadeIn), smooth((total - 1 - f) / fadeOut));
    out[f] = Math.max(0, Math.min(1, base * env));
  }
  return out;
}

export const AudioLayer: React.FC<{ props: VideoProps }> = ({ props }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const intervals = useMemo(() => voiceIntervals(props.scenes, fps), [props.scenes, fps]);
  const music = props.music;
  const volumes = useMemo(
    () => (music ? buildMusicVolumes(durationInFrames, intervals, fps, music.volume, music.duckedVolume) : null),
    [music, durationInFrames, intervals, fps],
  );

  return (
    <>
      {props.scenes.map((s) =>
        s.audioSrc ? (
          <Sequence
            key={`voice-${s.id}`}
            name={`Голос ${s.id}`}
            from={s.startFrame + s.audioStartFrame}
            durationInFrames={Math.max(1, Math.ceil((s.audioDurationMs / 1000) * fps) + 6)}
            layout="none"
          >
            <Html5Audio src={resolveSrc(s.audioSrc)} />
          </Sequence>
        ) : null,
      )}
      {music && volumes ? (
        <Html5Audio
          src={resolveSrc(music.src)}
          loop
          // "extend": кадр в колбэке растёт сквозь повторы трека, а не сбрасывается
          loopVolumeCurveBehavior="extend"
          volume={(f) => volumes[Math.max(0, Math.min(volumes.length - 1, Math.round(f)))]}
        />
      ) : null}
      {props.transitionFrames > 0
        ? props.scenes.slice(1).map((s, i) => {
            // Варианты свиста по кругу и чуть разная громкость — склейки не звучат одинаково.
            const variants = props.sfx?.whooshes?.length ? props.sfx.whooshes : props.whooshSrc ? [props.whooshSrc] : [];
            if (variants.length === 0) return null;
            return (
              <Sequence
                key={`whoosh-${s.id}`}
                name={`Свист ${s.id}`}
                from={Math.max(0, s.startFrame - WHOOSH_LEAD_FRAMES)}
                durationInFrames={Math.round(fps * 2)}
                layout="none"
              >
                <Html5Audio src={resolveSrc(variants[i % variants.length]!)} volume={props.sfxVolume * WHOOSH_GAIN[i % WHOOSH_GAIN.length]!} />
              </Sequence>
            );
          })
        : null}
      <SceneSfx props={props} />
    </>
  );
};

// Звуки под голосом — заметно тише свиста переходов (тот звучит в паузе между
// сценами): «пузырёк» пункта, удар и нарастание у крупной цифры, искра заставки.
const WHOOSH_GAIN = [1, 0.86, 0.93];
const POP_GAIN = 0.5;
const IMPACT_GAIN = 0.9;
const RISE_GAIN = 0.38;
const STING_GAIN = 0.45;
const RISE_FRAMES = 36; // длина rise.wav (1,2 с): его конец совпадает с ударом

const SceneSfx: React.FC<{ props: VideoProps }> = ({ props }) => {
  const { fps } = useVideoConfig();
  const sfx = props.sfx;
  const cues = useMemo(() => (sfx ? props.scenes.map((s) => sceneCues(s, fps)) : []), [sfx, props.scenes, fps]);
  if (!sfx) return null;
  const v = props.sfxVolume;
  const at = (from: number, key: string, name: string, src: string, volume: number, frames: number) => (
    <Sequence key={key} name={name} from={Math.max(0, Math.round(from))} durationInFrames={frames} layout="none">
      <Html5Audio src={resolveSrc(src)} volume={volume} />
    </Sequence>
  );
  const out: React.ReactNode[] = [];
  if (sfx.sting && props.brandIntro) out.push(at(0, "sting", "Искра заставки", sfx.sting, v * STING_GAIN, Math.round(fps)));
  props.scenes.forEach((s, i) => {
    const c = cues[i];
    if (!c) return;
    if (sfx.pop) c.pops.forEach((f, k) => out.push(at(s.startFrame + f, `pop-${s.id}-${k}`, `Пункт ${s.id}`, sfx.pop!, v * POP_GAIN, Math.round(fps * 0.5))));
    if (sfx.rise) c.rises.forEach((f, k) => out.push(at(s.startFrame + f - RISE_FRAMES, `rise-${s.id}-${k}`, `Нарастание ${s.id}`, sfx.rise!, v * RISE_GAIN, RISE_FRAMES + 2)));
    if (sfx.impact) c.impacts.forEach((f, k) => out.push(at(s.startFrame + f, `impact-${s.id}-${k}`, `Удар ${s.id}`, sfx.impact!, v * IMPACT_GAIN, Math.round(fps))));
  });
  return <>{out}</>;
};
