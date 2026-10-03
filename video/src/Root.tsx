import { Composition } from "remotion";
import { MonacoOverwrite, MONACO_DURATION } from "./monaco/MonacoOverwrite";

export const Root = () => (
  <Composition
    id="MonacoOverwrite"
    component={MonacoOverwrite}
    durationInFrames={MONACO_DURATION}
    fps={30}
    width={1920}
    height={1080}
  />
);
