import { describe, it, expect } from "vitest";
import { classifyRegion, decideAction } from "../../src/core/region.js";

describe("classifyRegion", () => {
  it("classifies indices before the separator as pinned", () => {
    expect(classifyRegion(0, 3)).toBe("pinned");
    expect(classifyRegion(2, 3)).toBe("pinned");
  });

  it("classifies indices at or after the separator as dynamic", () => {
    expect(classifyRegion(3, 3)).toBe("dynamic");
    expect(classifyRegion(5, 3)).toBe("dynamic");
  });
});

describe("decideAction", () => {
  it("promotes when target is pinned and not currently tracked as pinned", () => {
    expect(decideAction(null, "pinned")).toBe("promote");
    expect(decideAction("dynamic", "pinned")).toBe("promote");
  });

  it("demotes when target is dynamic and currently tracked as pinned", () => {
    expect(decideAction("pinned", "dynamic")).toBe("demote");
  });

  it("stays dynamic when target is dynamic and not currently pinned", () => {
    expect(decideAction(null, "dynamic")).toBe("stayDynamic");
    expect(decideAction("dynamic", "dynamic")).toBe("stayDynamic");
  });

  it("stays pinned when target is pinned and already tracked as pinned", () => {
    expect(decideAction("pinned", "pinned")).toBe("stayPinned");
  });
});