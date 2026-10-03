import { getModeStars, type LevelMode, type ProgressData } from "./progress";

export const CAMPAIGN_LENGTH = 30;
export const isCampaignFinale = (
  levelId: number,
  mode: LevelMode,
  won: boolean,
  context: { debug?: boolean; demo?: boolean; practice?: boolean } = {},
) =>
  levelId === CAMPAIGN_LENGTH &&
  mode === "normal" &&
  won &&
  !context.debug &&
  !context.demo &&
  !context.practice;

export const canReplayEpilogue = (
  progress: ProgressData,
  context: { debug?: boolean; demo?: boolean } = {},
) => !context.debug && !context.demo && getModeStars(progress, CAMPAIGN_LENGTH).normal > 0;

export const campaignSummary = (progress: ProgressData) => {
  let cleared = 0;
  let normalStars = 0;
  let breach = 0;
  let containment = 0;
  for (let id = 1; id <= CAMPAIGN_LENGTH; id++) {
    const stars = getModeStars(progress, id);
    cleared += Number(stars.normal > 0);
    normalStars += stars.normal;
    breach += stars.breach;
    containment += stars.containment;
  }
  return { cleared, normalStars, breach, containment };
};
