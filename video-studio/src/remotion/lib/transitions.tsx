import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { iris } from "@remotion/transitions/iris";
import type { RenderScene } from "../../types";

// Выбор перехода между сценами. Фон ролика общий и непрерывный (лежит под
// TransitionSeries), поэтому сцены без визуала прозрачны: для них годятся
// только переходы, где старая сцена уходит целиком (fade/slide/zoom),
// а «шторки» (wipe/iris) — только когда входящая сцена непрозрачна (визуал).

type ZoomProps = { strength: number };

// «Пролёт сквозь кадр»: уходящая сцена увеличивается и тает, новая
// приезжает из глубины. Даёт ощущение объёма и подходит под свист.
const ZoomThrough: React.FC<TransitionPresentationComponentProps<ZoomProps>> = ({
  children,
  presentationDirection,
  presentationProgress,
  passedProps,
}) => {
  const p = presentationProgress;
  const k = passedProps.strength;
  const style: React.CSSProperties =
    presentationDirection === "exiting"
      ? {
          transform: `scale(${interpolate(p, [0, 1], [1, 1 + 0.35 * k], { easing: Easing.in(Easing.cubic) })})`,
          opacity: interpolate(p, [0, 0.3], [1, 0], { extrapolateRight: "clamp" }),
        }
      : {
          transform: `scale(${interpolate(p, [0, 1], [1 - 0.22 * k, 1], { easing: Easing.out(Easing.cubic) })})`,
          // Почти без наложения: два заголовка поверх друг друга на полупрозрачности
          // выглядят «грязно» — движение и масштаб и так связывают сцены. Но и
          // без долгого провала: старая сцена гаснет быстро, новая проявляется
          // сразу за ней, а не к концу перехода (было ≈ 0,3 с почти пустого кадра).
          opacity: interpolate(p, [0.15, 0.55], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

export const zoomThrough = (strength = 1): TransitionPresentation<ZoomProps> => ({
  component: ZoomThrough,
  props: { strength },
});

type LiftProps = { distance: number };
// Мягкий подъём: старая сцена уезжает вверх и гаснет, новая поднимается снизу.
// Спокойнее, чем slide на весь экран, — для цитат и пунктов. Старая гаснет
// к p = 0,3, как в ZoomThrough: иначе в кадре, где проявляется новая, оба
// текста висят друг на друге полупрозрачными.
const Lift: React.FC<TransitionPresentationComponentProps<LiftProps>> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const p = presentationProgress;
  const d = passedProps.distance;
  const style: React.CSSProperties =
    presentationDirection === "exiting"
      ? { transform: `translateY(${interpolate(p, [0, 1], [0, -d])}px)`, opacity: interpolate(p, [0, 0.3], [1, 0], { extrapolateRight: "clamp" }) }
      : { transform: `translateY(${interpolate(p, [0, 1], [d, 0])}px)`, opacity: interpolate(p, [0.2, 0.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};
export const lift = (distance: number): TransitionPresentation<LiftProps> => ({ component: Lift, props: { distance } });

const hasVisual = (s: RenderScene) => s.visual.type !== "none";

export function pickTransition(
  prev: RenderScene,
  next: RenderScene,
  index: number, // индекс входящей сцены
  size: { width: number; height: number },
): TransitionPresentation<Record<string, unknown>> {
  const anyP = <T extends Record<string, unknown>>(p: TransitionPresentation<T>) => p as unknown as TransitionPresentation<Record<string, unknown>>;
  const alt = index % 2 === 0;
  if (hasVisual(next)) {
    // Непрозрачная сцена может «вытирать» предыдущую.
    if (next.kind === "media") return anyP(wipe({ direction: alt ? "from-bottom-left" : "from-top-right" }));
    return index % 3 === 0 ? anyP(iris({ width: size.width, height: size.height })) : anyP(wipe({ direction: alt ? "from-left" : "from-right" }));
  }
  switch (next.kind) {
    case "stat":
    case "cta":
    case "hook":
      return anyP(zoomThrough(next.kind === "cta" ? 0.8 : 1));
    case "list":
      return anyP(slide({ direction: "from-bottom" }));
    case "quote":
      return anyP(lift(size.height * 0.08));
    case "media":
      return anyP(hasVisual(prev) ? fade({ shouldFadeOutExitingScene: true }) : slide({ direction: alt ? "from-right" : "from-left" }));
    case "statement":
    default:
      return anyP(hasVisual(prev) ? fade({ shouldFadeOutExitingScene: true }) : slide({ direction: alt ? "from-right" : "from-left" }));
  }
}
