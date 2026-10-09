import React, { useMemo } from "react";
import { AbsoluteFill, Easing, Sequence, useVideoConfig } from "remotion";
import { BrandSting, STING_FRAMES } from "./brand/BrandSting";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import type { RenderScene, VideoProps } from "../types";
import { AudioLayer } from "./components/AudioLayer";
import { Background } from "./components/Background";
import { Captions } from "./components/Captions";
import { ProgressBar } from "./components/ProgressBar";
import { FontGate } from "./fonts";
import { LayoutContext, computeLayout } from "./lib/layout";
import { specialLayout } from "./lib/cues";
import { pickTransition } from "./lib/transitions";
import { sceneComponent } from "./scenes";
import { ChapterWrap } from "./scenes/ChapterCard"; // карточки глав «Разбора»
import { CompareScene } from "./scenes/CompareScene";
import { MapScene } from "./scenes/MapScene";
import { StatementScene } from "./scenes/StatementScene";
import { getTheme } from "./theme";

// Composition требует Props extends Record<string, unknown>, а VideoProps —
// interface; пересечение снимает ограничение, не меняя общий контракт.
export type VideoCompositionProps = VideoProps & Record<string, unknown>;

const TRANSITION_EASING = Easing.bezier(0.65, 0, 0.35, 1);

function pickScene(scene: RenderScene) {
  // Карта и сравнение (необязательные поля сцены) заменяют обычную раскладку.
  const special = specialLayout(scene);
  if (special === "map") return MapScene;
  if (special === "compare") return CompareScene;
  // Сцена без данных для своего типа — честно рисуем как утверждение.
  if (scene.kind === "list" && !(scene.items && scene.items.length > 0)) return StatementScene;
  if (scene.kind === "stat" && !scene.stat) return StatementScene;
  return sceneComponent(scene.kind);
}

export const Video: React.FC<VideoCompositionProps> = (props) => {
  const { width, height } = useVideoConfig();
  const theme = getTheme(props.theme);
  const layout = useMemo(() => computeLayout(props.format, width, height, props.showCaptions), [props.format, width, height, props.showCaptions]);
  const T = Math.max(0, Math.round(props.transitionFrames));
  const scenes = props.scenes;
  const cuts = useMemo(() => scenes.slice(1).map((s) => s.startFrame - 4), [scenes]);

  useMemo(() => {
    // Тайминг звука берётся из startFrame, картинки — из TransitionSeries;
    // если props собраны не через layoutScenes(), они разъедутся — предупредим.
    if (scenes.length === 0) return;
    const expected = scenes.reduce((s, sc) => s + sc.durationInFrames, 0) - (scenes.length - 1) * T;
    if (expected !== props.durationInFrames) {
      console.warn(`[Video] сумма длительностей сцен (${expected}) ≠ durationInFrames (${props.durationInFrames}) — проверьте layoutScenes()`);
    }
  }, [scenes, T, props.durationInFrames]);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bgFrom }}>
      <FontGate>
        <LayoutContext.Provider value={layout}>
          <Background theme={theme} seed={props.title} cuts={cuts} cutFrames={Math.max(18, T + 8)} />
          <TransitionSeries name="Сцены">
            {scenes.map((scene, i) => {
              const Comp = pickScene(scene);
              return (
                <React.Fragment key={scene.id || i}>
                  {i > 0 && T > 0 ? (
                    <TransitionSeries.Transition
                      timing={linearTiming({ durationInFrames: T, easing: TRANSITION_EASING })}
                      presentation={pickTransition(scenes[i - 1], scene, i, { width, height })}
                    />
                  ) : null}
                  <TransitionSeries.Sequence durationInFrames={Math.max(1, scene.durationInFrames)} name={`${i + 1}. ${scene.kind}`}>
                    <ChapterWrap Comp={Comp} scene={scene} index={i} theme={theme} video={props} />
                  </TransitionSeries.Sequence>
                </React.Fragment>
              );
            })}
          </TransitionSeries>
          {props.showCaptions ? <Captions captions={props.captions} theme={theme} /> : null}
          {props.showProgressBar ? <ProgressBar theme={theme} /> : null}
          {props.brandIntro ? (
            <Sequence durationInFrames={STING_FRAMES} name="Бренд-заставка" layout="none">
              <BrandSting theme={theme} />
            </Sequence>
          ) : null}
        </LayoutContext.Provider>
      </FontGate>
      <AudioLayer props={props} />
    </AbsoluteFill>
  );
};
