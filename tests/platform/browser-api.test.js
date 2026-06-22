import { describe, it, expect } from "vitest";
import * as api from "../../src/platform/browser-api.js";
import { createFirefoxAdapter } from "../../src/platform/firefox-adapter.js";

// browser-api.js re-exports a hand-written list of names destructured from
// the active adapter. Adding a method to an adapter (e.g. firefox-adapter.js)
// without adding it to that destructuring list silently leaves it undefined
// here — exactly the bug that broke getPaused/getExpectedEvents previously.
// This guards against that regression by checking every adapter method made
// it through.
describe("browser-api re-exports", () => {
  it("exposes every method the firefox adapter implements", () => {
    const adapter = createFirefoxAdapter();

    for (const key of Object.keys(adapter)) {
      expect(api[key], `browser-api.js does not re-export "${key}"`).toBeDefined();
      expect(typeof api[key]).toBe(typeof adapter[key]);
    }
  });
});
