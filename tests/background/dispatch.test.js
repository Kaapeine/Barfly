import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID } from "../../src/platform/browser-api.js";
import { runInstall } from "../../src/background/install.js";
import { createDispatcher } from "../../src/background/dispatch.js";

async function setup() {
  const api = createFakeBrowserApi();
  const state = await runInstall(api);
  const dispatcher = createDispatcher(api);
  await dispatcher.setState(state);
  dispatcher.registerEventHandlers();
  return { api, dispatcher };
}

describe("createDispatcher", () => {
  it("syncs a rename to the counterpart exactly once and does not loop", async () => {
    const { api, dispatcher } = await setup();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    // Let the dispatcher auto-create the toolbar duplicate via its normal flow,
    // rather than fabricating one by hand (which would race the dispatcher's
    // own handling of `orig`'s creation and produce a second, untracked dup).
    await dispatcher.drain();
    const dupId = (await dispatcher.getState()).entries[0].duplicateId;

    let changedCount = 0;
    api.onBookmarkChanged(() => { changedCount += 1; });

    // External rename of the original.
    await api.updateBookmark(orig.id, { title: "A renamed" });
    await dispatcher.drain();

    expect((await api.getBookmark(dupId)).title).toBe("A renamed");
    // One change is our own sync to the duplicate; it must NOT bounce back.
    expect(changedCount).toBe(2); // orig (external) + dup (our sync), then stop
  });

  it("ignores events for our own mutations (no runaway growth on create)", async () => {
    const { api, dispatcher } = await setup();
    await api.createBookmark({ parentId: "folder", title: "X", url: "https://x.test" });
    await dispatcher.drain();

    // The new bookmark produced exactly one toolbar duplicate, and the
    // duplicate's own onCreated was suppressed (no duplicate-of-duplicate).
    const dynamic = (await api.getChildren(TOOLBAR_ID)).filter((c) => c.type === "bookmark");
    expect(dynamic).toHaveLength(1);
    expect((await dispatcher.getState()).entries).toHaveLength(1);
  });

  it("does not process events while paused", async () => {
    const { api, dispatcher } = await setup();
    await dispatcher.setPaused(true);
    await api.createBookmark({ parentId: "folder", title: "Y", url: "https://y.test" });
    await dispatcher.drain();
    expect((await dispatcher.getState()).entries).toHaveLength(0);
  });
});
