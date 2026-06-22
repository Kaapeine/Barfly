import { describe, it, expect } from "vitest";
import { createExpectedSet, createTrackingApi } from "../../src/core/suppression.js";

// Mimics the storage-backed adapter methods (browser.storage.session under
// the hood) that createExpectedSet now persists through, so marks survive a
// service-worker restart instead of living only in an in-memory Set.
function fakeStorageApi() {
  let events = [];
  return {
    async getExpectedEvents() {
      return events;
    },
    async setExpectedEvents(next) {
      events = next;
    },
  };
}

describe("createExpectedSet", () => {
  it("consume returns false for an event we never marked", async () => {
    const set = createExpectedSet(fakeStorageApi());
    expect(await set.consume("changed", "1")).toBe(false);
  });

  it("consume returns true exactly once for a marked event", async () => {
    const set = createExpectedSet(fakeStorageApi());
    await set.mark("changed", "1");
    expect(await set.consume("changed", "1")).toBe(true);
    expect(await set.consume("changed", "1")).toBe(false);
  });

  it("distinguishes event types for the same id", async () => {
    const set = createExpectedSet(fakeStorageApi());
    await set.mark("removed", "1");
    expect(await set.consume("created", "1")).toBe(false);
    expect(await set.consume("removed", "1")).toBe(true);
  });

  it("evicts oldest marks beyond the cap so it cannot grow unbounded", async () => {
    const set = createExpectedSet(fakeStorageApi(), 2);
    await set.mark("created", "a");
    await set.mark("created", "b");
    await set.mark("created", "c"); // evicts "a"
    expect(await set.consume("created", "a")).toBe(false);
    expect(await set.consume("created", "b")).toBe(true);
    expect(await set.consume("created", "c")).toBe(true);
  });

  it("survives being recreated against the same backing storage", async () => {
    // Simulates a service-worker restart: a fresh createExpectedSet wrapping
    // the same persisted storage must still see marks from "before".
    const storage = fakeStorageApi();
    const before = createExpectedSet(storage);
    await before.mark("changed", "1");

    const after = createExpectedSet(storage);
    expect(await after.consume("changed", "1")).toBe(true);
  });
});

describe("createTrackingApi", () => {
  it("marks created with the new node id", async () => {
    const set = createExpectedSet(fakeStorageApi());
    const base = { createBookmark: async () => ({ id: "99" }) };
    const api = createTrackingApi(base, set);
    const node = await api.createBookmark({ title: "x" });
    expect(node.id).toBe("99");
    expect(await set.consume("created", "99")).toBe(true);
  });

  it("marks removed / moved / changed with the target id", async () => {
    const set = createExpectedSet(fakeStorageApi());
    const base = {
      removeBookmark: async () => {},
      moveBookmark: async () => {},
      updateBookmark: async () => {},
    };
    const api = createTrackingApi(base, set);
    await api.removeBookmark("1");
    await api.moveBookmark("2", {});
    await api.updateBookmark("3", {});
    expect(await set.consume("removed", "1")).toBe(true);
    expect(await set.consume("moved", "2")).toBe(true);
    expect(await set.consume("changed", "3")).toBe(true);
  });

  it("passes through non-mutating methods untouched", () => {
    const set = createExpectedSet(fakeStorageApi());
    const base = { TOOLBAR_ID: "toolbar_____", getChildren: async () => [] };
    const api = createTrackingApi(base, set);
    expect(api.TOOLBAR_ID).toBe("toolbar_____");
    expect(typeof api.getChildren).toBe("function");
  });
});
