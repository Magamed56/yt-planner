import type React from "react";
import type { SceneKind } from "../../types";
import type { SceneProps } from "./common";
import { CtaScene } from "./CtaScene";
import { HookScene } from "./HookScene";
import { ListScene } from "./ListScene";
import { MediaScene } from "./MediaScene";
import { QuizScene } from "./QuizScene";
import { QuoteScene } from "./QuoteScene";
import { StatScene } from "./StatScene";
import { StatementScene } from "./StatementScene";

export const SCENE_COMPONENTS: Record<SceneKind, React.FC<SceneProps>> = {
  hook: HookScene,
  statement: StatementScene,
  list: ListScene,
  stat: StatScene,
  quote: QuoteScene,
  media: MediaScene,
  cta: CtaScene,
  quiz: QuizScene, // «Правда или миф?»
};

// Неизвестный тип сцены (ошибка LLM) рисуем как обычное утверждение.
export const sceneComponent = (kind: string): React.FC<SceneProps> =>
  SCENE_COMPONENTS[kind as SceneKind] ?? StatementScene;

export type { SceneProps };
