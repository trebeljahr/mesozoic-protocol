import { describe, expect, it } from "vitest";
import { campaignSummary, canReplayEpilogue, isCampaignFinale } from "./campaignSummary";
import { emptyProgress, recordLevelResult } from "./progress";

describe("campaign conclusion", () => {
  it("only marks the normal final victory as a campaign finale", () => {
    expect(isCampaignFinale(30, "normal", true)).toBe(true);
    expect(isCampaignFinale(29, "normal", true)).toBe(false);
    expect(isCampaignFinale(30, "normal", false)).toBe(false);
    expect(isCampaignFinale(30, "breach", true)).toBe(false);
    expect(isCampaignFinale(30, "containment", true)).toBe(false);
    for (const context of [{ debug: true }, { demo: true }, { practice: true }]) {
      expect(isCampaignFinale(30, "normal", true, context)).toBe(false);
    }
  });
  it("keeps the ending hidden until normal outpost 30 is cleared, including existing saves", () => {
    let progress = emptyProgress();
    expect(canReplayEpilogue(progress)).toBe(false);
    progress = recordLevelResult(progress, 30, "breach", 1);
    expect(canReplayEpilogue(progress)).toBe(false);
    progress = recordLevelResult(progress, 30, "normal", 1);
    expect(canReplayEpilogue(progress)).toBe(true);
    expect(canReplayEpilogue(progress, { debug: true })).toBe(false);
    expect(canReplayEpilogue(progress, { demo: true })).toBe(false);
  });
  it("summarizes recorded results rather than assuming all previous outposts were completed", () => {
    let progress = recordLevelResult(emptyProgress(), 30, "normal", 1);
    progress = recordLevelResult(progress, 1, "normal", 3);
    progress = recordLevelResult(progress, 1, "breach", 1);
    progress = recordLevelResult(progress, 1, "containment", 1);
    expect(campaignSummary(progress)).toEqual({
      cleared: 2,
      normalStars: 4,
      breach: 1,
      containment: 1,
    });
  });
});
