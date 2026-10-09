import demo from "../../../examples/demo-ru.json";
import type { VideoProps, VideoScript } from "../../types";
import { buildFixtureProps } from "./buildFixture";

// defaultProps для Studio: демо-сценарий без аудио, работает офлайн.
export const demoScript = demo as unknown as VideoScript;
export const demoProps: VideoProps = buildFixtureProps(demoScript);
