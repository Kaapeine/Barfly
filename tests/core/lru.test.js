import { describe, it, expect } from "vitest";
import { touchDynamic, addDynamic, evictToCapacity } from "../../src/core/lru.js";

describe("touchDynamic", () => {
  it("moves an existing id to the front", () => {
    expect(touchDynamic(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("is a no-op if the id is already at the front", () => {
    expect(touchDynamic(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("leaves the order unchanged if the id is not present", () => {
    expect(touchDynamic(["a", "b"], "z")).toEqual(["a", "b"]);
  });
});

describe("addDynamic", () => {
  it("adds a new id to the front with no eviction when under capacity", () => {
    expect(addDynamic(["a", "b"], "c", 5)).toEqual({ order: ["c", "a", "b"], evicted: [] });
  });

  it("evicts the tail when adding exceeds capacity", () => {
    expect(addDynamic(["a", "b", "c"], "d", 3)).toEqual({ order: ["d", "a", "b"], evicted: ["c"] });
  });
});

describe("evictToCapacity", () => {
  it("evicts from the tail until the order fits capacity", () => {
    expect(evictToCapacity(["a", "b", "c", "d"], 2)).toEqual({ order: ["a", "b"], evicted: ["c", "d"] });
  });

  it("evicts nothing when already within capacity", () => {
    expect(evictToCapacity(["a", "b"], 5)).toEqual({ order: ["a", "b"], evicted: [] });
  });
});
