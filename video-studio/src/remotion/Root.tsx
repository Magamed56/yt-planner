import React from "react";
import { Composition, Still, type CalculateMetadataFunction } from "remotion";
import { FORMAT_SIZE, FPS } from "../types";
import { demoProps } from "./fixtures/demoProps";
import { Thumbnail } from "./Thumbnail";
import { Video, type VideoCompositionProps } from "./Video";

// Размер и длительность — из props: один и тот же бандл рендерит и Shorts,
// и горизонтальные ролики любой длины.
const calculateMetadata: CalculateMetadataFunction<VideoCompositionProps> = ({ props }) => {
  const size = FORMAT_SIZE[props.format] ?? FORMAT_SIZE.shorts;
  return {
    width: size.width,
    height: size.height,
    fps: FPS,
    durationInFrames: Math.max(1, Math.round(props.durationInFrames)),
  };
};

const defaults = demoProps as VideoCompositionProps;

export const Root: React.FC = () => (
  <>
    <Composition
      id="Video"
      component={Video}
      width={FORMAT_SIZE.shorts.width}
      height={FORMAT_SIZE.shorts.height}
      fps={FPS}
      durationInFrames={Math.max(1, defaults.durationInFrames)}
      defaultProps={defaults}
      calculateMetadata={calculateMetadata}
    />
    <Still id="Thumbnail" component={Thumbnail} width={1280} height={720} defaultProps={defaults} />
  </>
);
