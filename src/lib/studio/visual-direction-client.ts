import type { PictureIntake } from "./picture-intake.ts";
import { boardImage } from "./visual-direction-board.ts";
import { analyzeVisualDirection } from "./visual-direction-api.ts";
import { BrowserEndpointCache } from "./local-llm-endpoint.ts";

export async function prepareVisualDirection(intake: PictureIntake, writerId?: string, progress?: (message: string) => void): Promise<PictureIntake> {
  const direction = intake.visualDirection;
  if (!direction?.sources.length || (direction.guide && direction.analyzedBoardId === direction.boardId)) return intake;
  progress?.("Reading the visual direction board with a local vision model before screenplay writing…");
  await window.premiere316?.stills.unload();
  const result = await analyzeVisualDirection({ data: { image: await boardImage(direction.boardId), notes: direction.notes, writerId, endpoint: new BrowserEndpointCache().get() } });
  return { ...intake, visualDirection: { ...direction, guide: result.guide, analysisModel: result.model, analyzedBoardId: direction.boardId } };
}
