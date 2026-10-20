import { describe, expect, it } from "vitest";
import { rankMovement } from "@/lib/domain/scoring/movement";

describe("rankMovement", () => {
  it("returns new when there is no previous rank", () => {
    expect(rankMovement(1, null)).toBe("new");
  });

  it("returns up when the rank number improves", () => {
    expect(rankMovement(1, 4)).toBe("up");
  });

  it("returns down when the rank number worsens", () => {
    expect(rankMovement(5, 2)).toBe("down");
  });

  it("returns same when the rank is unchanged", () => {
    expect(rankMovement(3, 3)).toBe("same");
  });
});
