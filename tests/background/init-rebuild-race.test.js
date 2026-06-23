import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { createDispatcher } from "../../src/background/dispatch.js";
import { runInstall } from "../../src/background/install.js";
import { rebuildFromToolbar } from "../../src/background/events.js";
import { TOOLBAR_ID } from "../../src/platform/browser-api.js";

describe("init rebuild racing a multi-item drag", () => {
  it("does not delete bookmarks mid-drag when the rebuild is serialized through the queue", async () => {
    const api = createFakeBrowserApi();
    await api.setPaused(true);

    const originals = [];
    for (const letter of ["A", "B", "C", "D", "E"]) {
      originals.push(
        await api.createBookmark({ parentId: "folder", title: letter, url: `https://${letter}.test` }),
      );
    }
    const installedState = await runInstall(api, 30);
    await api.setState(installedState);
    await api.setPaused(false);

    // Fresh worker spins up exactly as background.js does: dispatcher/queue
    // created and listeners registered synchronously...
    const dispatcher = createDispatcher(api);
    dispatcher.registerEventHandlers();

    // ...then the browser delivers the burst of onMoved events that woke it
    // (the user's multi-select drag onto the toolbar)...
    for (const orig of originals) {
      await api.moveBookmark(orig.id, { parentId: TOOLBAR_ID, index: 1 });
    }

    // ...racing init()'s rebuildFromToolbar call, now serialized through the
    // same queue instead of running unqueued (the real fix, mirrored here).
    const state = await api.getState();
    const rebuildPromise = dispatcher.queue.enqueue(async () => {
      const result = await rebuildFromToolbar(api, state);
      await api.setState({ ...result.state, entries: result.entries });
    });

    await Promise.all([dispatcher.drain(), rebuildPromise]);
    await dispatcher.drain();

    for (const orig of originals) {
      const node = await api.getBookmark(orig.id);
      expect(node).not.toBeNull();
    }
  });
});

describe("init rebuild adopting an orphan toolbar bookmark", () => {
  it("does not spawn a second duplicate when adopting through the tracking api", async () => {
    const api = createFakeBrowserApi();
    const dispatcher = createDispatcher(api);
    dispatcher.registerEventHandlers();

    // A lone orphan bookmark sits on the toolbar at startup (created while
    // paused so no handler runs yet), and BarFly has saved state.
    await api.setPaused(true);
    const installed = await runInstall(api, 30);
    await api.setState(installed);
    const orphan = await api.createBookmark({ parentId: TOOLBAR_ID, index: 1, title: "X", url: "https://x.test" });
    await dispatcher.drain();
    await api.setPaused(false);

    // init()'s rebuild, exactly as background.js wires it: through the queue
    // AND the tracking api so the adoption-create's echo is suppressed.
    const resolved = await api.getState();
    await dispatcher.queue.enqueue(async () => {
      const result = await rebuildFromToolbar(dispatcher.trackingApi, resolved);
      await dispatcher.setState({ ...result.state, entries: result.entries });
    });
    await dispatcher.drain();

    // Exactly one toolbar bookmark for the orphan url (the orphan itself) —
    // the suppressed onCreated echo must NOT have spawned another duplicate.
    const toolbarDups = (await api.getChildren(TOOLBAR_ID)).filter(
      (c) => c.type === "bookmark" && c.url === "https://x.test",
    );
    expect(toolbarDups).toHaveLength(1);
    expect(toolbarDups[0].id).toBe(orphan.id);

    const state = await api.getState();
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].duplicateId).toBe(orphan.id);
  });
});
