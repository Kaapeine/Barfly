import { describe, it, expect } from "vitest";
import { createSuppressionGuard } from "../../src/core/guard.js";

describe("createSuppressionGuard", () => {
  it("is not suppressed before any run() call", () => {
    const guard = createSuppressionGuard();
    expect(guard.isSuppressed()).toBe(false);
  });

  it("reports suppressed while run()'s callback is executing", async () => {
    const guard = createSuppressionGuard();
    let sawSuppressedDuring;
    await guard.run(async () => {
      sawSuppressedDuring = guard.isSuppressed();
    });
    expect(sawSuppressedDuring).toBe(true);
    expect(guard.isSuppressed()).toBe(false);
  });

  it("clears suppression even if the callback throws", async () => {
    const guard = createSuppressionGuard();
    await expect(
      guard.run(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(guard.isSuppressed()).toBe(false);
  });
});