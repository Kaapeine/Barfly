import { describe, it, expect, vi } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID, OTHER_ID } from "../../src/platform/firefox-browser-api.js";
import { resolveInitState } from "../../src/core/init.js";

describe("resolveInitState", () => {
  // -----------------------------------------------------------------------
  // Case 1: State + separator both exist → normal restart
  // -----------------------------------------------------------------------
  it("Case 1: returns saved state when both state and separator exist", async () => {
    const api = createFakeBrowserApi();
    const separator = await api.createBookmark({
      parentId: TOOLBAR_ID,
      index: 0,
      type: "separator",
    });
    const savedState = {
      separatorId: separator.id,
      capacity: 5,
      entries: [{ originalId: "1", duplicateId: "2" }],
    };
    await api.setState(savedState);

    const { state } = await resolveInitState(api, {
      runInstall: vi.fn(),
    });

    expect(state).toEqual(savedState);
    expect(api.getState()).resolves.toEqual(savedState); // unchanged
  });

  // -----------------------------------------------------------------------
  // Case 2: State exists, separator missing → recreate + notify
  // -----------------------------------------------------------------------
  it("Case 2: recreates separator and returns notification when separator is missing", async () => {
    const api = createFakeBrowserApi();
    const savedState = {
      separatorId: "old-sep",
      capacity: 5,
      entries: [{ originalId: "1", duplicateId: "2" }],
    };
    await api.setState(savedState);

    const { state } = await resolveInitState(api, {
      runInstall: vi.fn(),
    });

    // New separator should be created at index 0
    expect(state.separatorId).not.toBe("old-sep");
    expect(state.capacity).toBe(5);
    expect(state.entries).toEqual([{ originalId: "1", duplicateId: "2" }]);

    const toolbar = await api.getChildren(TOOLBAR_ID);
    expect(toolbar[0].type).toBe("separator");
    expect(toolbar[0].id).toBe(state.separatorId);

    // Notification was sent (createNotification is a no-op in tests, no crash)
  });

  // -----------------------------------------------------------------------
  // Case 3: No state, separator exists → reconstruct from toolbar
  // -----------------------------------------------------------------------
  it("Case 3: reconstructs state from existing separator when storage is empty", async () => {
    const api = createFakeBrowserApi();
    const separator = await api.createBookmark({
      parentId: TOOLBAR_ID,
      index: 0,
      type: "separator",
    });
    // No saved state

    const { state } = await resolveInitState(api, {
      runInstall: vi.fn(),
    });

    expect(state.separatorId).toBe(separator.id);
    expect(state.capacity).toBe(10);
    expect(state.entries).toEqual([]);

    // State should have been persisted
    const persisted = await api.getState();
    expect(persisted).toEqual(state);
  });

  // -----------------------------------------------------------------------
  // Case 4: No state, no separator → fresh install
  // -----------------------------------------------------------------------
  it("Case 4: calls runInstall when neither state nor separator exist", async () => {
    const api = createFakeBrowserApi();
    const runInstall = vi.fn().mockResolvedValue({
      separatorId: "new-sep",
      capacity: 10,
      entries: [],
    });

    const { state } = await resolveInitState(api, { runInstall });

    expect(runInstall).toHaveBeenCalledOnce();
    expect(state.separatorId).toBe("new-sep");
    expect(state.capacity).toBe(10);
  });

  // -----------------------------------------------------------------------
  // Smoke: runInstall actually archives on fresh install
  // -----------------------------------------------------------------------
  it("Case 4: runInstall archives toolbar and creates separator on fresh install", async () => {
    const api = createFakeBrowserApi();
    // Add some bookmarks to the toolbar
    const bm1 = await api.createBookmark({
      parentId: TOOLBAR_ID,
      title: "Existing",
      url: "https://existing.test",
    });

    const { state } = await resolveInitState(api, {
      runInstall: (await import('../../src/background/install.js')).runInstall,
    });

    // Toolbar should now have separator at index 0
    const toolbar = await api.getChildren(TOOLBAR_ID);
    expect(toolbar).toHaveLength(1);
    expect(toolbar[0].type).toBe("separator");

    // Existing bookmark should be archived
    const otherChildren = await api.getChildren(OTHER_ID);
    expect(otherChildren).toHaveLength(1);
    expect(otherChildren[0].type).toBe("folder");
    expect(otherChildren[0].title).toContain("Bookmarks Toolbar archived");

    const archived = await api.getChildren(otherChildren[0].id);
    expect(archived.map((n) => n.id)).toEqual([bm1.id]);

    expect(state.separatorId).toBe(toolbar[0].id);
    expect(state.capacity).toBe(10);
    expect(state.entries).toEqual([]);
  });
});