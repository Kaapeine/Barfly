import { describe, it, expect } from "vitest";
import { createExpectedSet, createTrackingApi } from "../../src/core/suppression.js";

describe("createExpectedSet", () => {
  it("consume returns false for an event we never marked", () => {
    const set = createExpectedSet();
    expect(set.consume("changed", "1")).toBe(false);
  });

  it("consume returns true exactly once for a marked event", () => {
    const set = createExpectedSet();
    set.mark("changed", "1");
    expect(set.consume("changed", "1")).toBe(true);
    expect(set.consume("changed", "1")).toBe(false);
  });

  it("distinguishes event types for the same id", () => {
    const set = createExpectedSet();
    set.mark("removed", "1");
    expect(set.consume("created", "1")).toBe(false);
    expect(set.consume("removed", "1")).toBe(true);
  });

  it("evicts oldest marks beyond the cap so it cannot grow unbounded", () => {
    const set = createExpectedSet(2);
    set.mark("created", "a");
    set.mark("created", "b");
    set.mark("created", "c"); // evicts "a"
    expect(set.consume("created", "a")).toBe(false);
    expect(set.consume("created", "b")).toBe(true);
    expect(set.consume("created", "c")).toBe(true);
  });
});

describe("createTrackingApi", () => {
  it("marks created with the new node id", async () => {
    const set = createExpectedSet();
    const base = { createBookmark: async () => ({ id: "99" }) };
    const api = createTrackingApi(base, set);
    const node = await api.createBookmark({ title: "x" });
    expect(node.id).toBe("99");
    expect(set.consume("created", "99")).toBe(true);
  });

  it("marks removed / moved / changed with the target id", async () => {
    const set = createExpectedSet();
    const base = {
      removeBookmark: async () => {},
      moveBookmark: async () => {},
      updateBookmark: async () => {},
    };
    const api = createTrackingApi(base, set);
    await api.removeBookmark("1");
    await api.moveBookmark("2", {});
    await api.updateBookmark("3", {});
    expect(set.consume("removed", "1")).toBe(true);
    expect(set.consume("moved", "2")).toBe(true);
    expect(set.consume("changed", "3")).toBe(true);
  });

  it("passes through non-mutating methods untouched", () => {
    const set = createExpectedSet();
    const base = { TOOLBAR_ID: "toolbar_____", getChildren: async () => [] };
    const api = createTrackingApi(base, set);
    expect(api.TOOLBAR_ID).toBe("toolbar_____");
    expect(typeof api.getChildren).toBe("function");
  });
});
