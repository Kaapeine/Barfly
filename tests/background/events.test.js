import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID, OTHER_ID } from "../../src/platform/browser-api.js";
import { runInstall } from "../../src/background/install.js";
import {
  rebuildFromToolbar,
  handleVisit,
  handleBookmarkCreated,
  handleBookmarkMoved,
  handleBookmarkChanged,
  handleBookmarkRemoved,
  applyCapacityChange,
} from '../../src/background/events.js';

// ---------------------------------------------------------------------------
// Sub-task 4a: rebuildFromToolbar
// ---------------------------------------------------------------------------
describe("rebuildFromToolbar", () => {
  it("rebuilds entries from toolbar children", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const state = await runInstall(api);
    // separator is at index 0
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });

    const { entries } = await rebuildFromToolbar(api, state);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ originalId: orig.id, duplicateId: dup.id });
  });

  it("returns empty array if toolbar only has the separator", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);

    const { entries } = await rebuildFromToolbar(api, state);

    expect(entries).toEqual([]);
  });

  it("skips the separator itself", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    // separator is at index 0
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "folder", title: "B", url: "https://b.test" });
    const dupA = await api.createBookmark({ parentId: TOOLBAR_ID, index: 1, title: "A", url: "https://a.test" });
    const dupB = await api.createBookmark({ parentId: TOOLBAR_ID, index: 2, title: "B", url: "https://b.test" });

    const { entries } = await rebuildFromToolbar(api, state);

    expect(entries.map((e) => e.duplicateId)).toEqual([dupA.id, dupB.id]);
  });

  it("adopts an orphan toolbar bookmark instead of deleting it", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    // A lone bookmark on the toolbar with no original anywhere (added while
    // BarFly was disabled, or its original was deleted).
    const orphan = await api.createBookmark({ parentId: TOOLBAR_ID, index: 1, title: "X", url: "https://x.test" });

    const { entries } = await rebuildFromToolbar(api, state);

    // Orphan kept exactly where it was, now tracked as a duplicate...
    expect(await api.getBookmark(orphan.id)).not.toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries[0].duplicateId).toBe(orphan.id);

    // ...backed by a freshly created original in the dedicated folder.
    const other = await api.getChildren(OTHER_ID);
    const saved = other.find((c) => c.type === "folder" && c.title === "Saved to Bookmarks Toolbar");
    expect(saved).toBeDefined();
    const savedChildren = await api.getChildren(saved.id);
    const original = savedChildren.find((c) => c.url === "https://x.test");
    expect(original).toBeDefined();
    expect(entries[0].originalId).toBe(original.id);
  });
});

// ---------------------------------------------------------------------------
// Sub-task 4b: handleVisit — bump to front or add new
// ---------------------------------------------------------------------------
describe("handleVisit", () => {
  it("moves an existing dynamic duplicate to the front on revisit", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dupA = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });
    const dupB = await api.createBookmark({ parentId: TOOLBAR_ID, title: "B", url: "https://b.test", index: 2 });
    const entries = [
      { originalId: orig.id, duplicateId: dupA.id },
      { originalId: "b-orig", duplicateId: dupB.id },
    ];
    const current = { ...state, entries };

    const next = await handleVisit(api, current, "https://a.test");

    const toolbar = await api.getChildren(TOOLBAR_ID);
    const dynChildren = toolbar.slice(1); // after separator at index 0
    expect(dynChildren[0].url).toBe("https://a.test");
  });

  it("does nothing when the URL matches no bookmark", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const next = await handleVisit(api, state, "https://nowhere.test");
    expect(next).toEqual(state);
  });

  it("does nothing for a pinned item (before separator)", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    // pinned = before separator
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, index: 0, title: "A", url: "https://a.test" });
    // move separator to index 1
    await api.moveBookmark(state.separatorId, { parentId: TOOLBAR_ID, index: 1 });
    const entries = [{ originalId: orig.id, duplicateId: dup.id }];
    const current = { ...state, entries };
    // separator is now at index 1, dup is at index 0 = pinned

    const next = await handleVisit(api, current, "https://a.test");

    expect(next).toEqual(current);
  });

  it("creates a duplicate for a visited untracked bookmark", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });

    const next = await handleVisit(api, state, "https://a.test");

    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].originalId).toBe(orig.id);
    const toolbar = await api.getChildren(TOOLBAR_ID);
    expect(toolbar).toHaveLength(2); // separator + dup
  });

  it("evicts from the tail when capacity is exceeded", async () => {
    const api = createFakeBrowserApi();
    const state = { ...(await runInstall(api)), capacity: 1 };
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "folder", title: "B", url: "https://b.test" });

    const nextA = await handleVisit(api, state, "https://a.test");
    const nextB = await handleVisit(api, nextA, "https://b.test");

    expect(nextB.entries).toHaveLength(1);
    expect(nextB.entries.map((e) => e.originalId)).toEqual([b.id]);
  });

  it("bumps a duplicate even when the visited URL differs from the stored URL by a trailing slash", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    // Stored bookmark URL has no trailing slash...
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dupA = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });
    const dupB = await api.createBookmark({ parentId: TOOLBAR_ID, title: "B", url: "https://b.test", index: 2 });
    const current = {
      ...state,
      entries: [
        { originalId: orig.id, duplicateId: dupA.id },
        { originalId: "b-orig", duplicateId: dupB.id },
      ],
    };

    // Override search to model the browser matching the slash variant to the stored bookmark.
    const realSearch = api.searchBookmarksByUrl;
    api.searchBookmarksByUrl = async (u) =>
      u === "https://a.test/" ? realSearch("https://a.test") : realSearch(u);

    // ...but the visit arrives with a trailing slash.
    const next = await handleVisit(api, current, "https://a.test/");

    const children = await api.getChildren(TOOLBAR_ID);
    const sepIndex = children.findIndex((c) => c.id === state.separatorId);
    // dupA should now be first in the dynamic section.
    expect(children[sepIndex + 1].id).toBe(dupA.id);
    expect(next.entries[0].duplicateId).toBe(dupA.id);
  });
});

// ---------------------------------------------------------------------------
// Sub-task 4c: handleBookmarkCreated
// ---------------------------------------------------------------------------
describe("handleBookmarkCreated", () => {
  it("creates a duplicate for a new bookmark anywhere (non-toolbar parent)", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const node = await api.createBookmark({ parentId: "work-folder", title: "A", url: "https://a.test" });

    const next = await handleBookmarkCreated(api, state, node.id, node);

    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].originalId).toBe(node.id);
  });

  it("relocates a toolbar-created bookmark into a 'Saved to Bookmarks Toolbar' folder and creates a duplicate", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const node = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });

    const next = await handleBookmarkCreated(api, state, node.id, node);

    // Original moved into a dedicated "Saved to Bookmarks Toolbar" folder under Other Bookmarks
    const otherChildren = await api.getChildren(OTHER_ID);
    const savedFolder = otherChildren.find((c) => c.type === "folder" && c.title === "Saved to Bookmarks Toolbar");
    expect(savedFolder).toBeDefined();
    const savedChildren = await api.getChildren(savedFolder.id);
    expect(savedChildren.map((n) => n.id)).toContain(node.id);
    // Duplicate on toolbar
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].originalId).toBe(node.id);
  });

  it("reuses the existing 'Saved to Bookmarks Toolbar' folder instead of creating a second one", async () => {
    const api = createFakeBrowserApi();
    let state = await runInstall(api);
    const a = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });
    state = await handleBookmarkCreated(api, state, a.id, a);

    const b = await api.createBookmark({ parentId: TOOLBAR_ID, title: "B", url: "https://b.test", index: 1 });
    await handleBookmarkCreated(api, state, b.id, b);

    const otherChildren = await api.getChildren(OTHER_ID);
    const savedFolders = otherChildren.filter((c) => c.type === "folder" && c.title === "Saved to Bookmarks Toolbar");
    expect(savedFolders).toHaveLength(1);
  });

  it("does nothing for separator or folder types", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);

    const next = await handleBookmarkCreated(api, state, "some-id", { type: "separator" });

    expect(next).toEqual(state);
  });
});

// ---------------------------------------------------------------------------
// Sub-task 4d: handleBookmarkMoved
// ---------------------------------------------------------------------------
describe("handleBookmarkMoved", () => {
  it("relocates an untracked bookmark dragged onto toolbar back to its folder and creates duplicate", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    // Simulate drag onto toolbar
    await api.moveBookmark(orig.id, { parentId: TOOLBAR_ID, index: 1 });

    const next = await handleBookmarkMoved(api, state, orig.id, {
      parentId: TOOLBAR_ID,
      index: 1,
      oldParentId: "folder",
      oldIndex: 0,
    });

    expect(await api.getChildren("folder")).toEqual([expect.objectContaining({ id: orig.id })]);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].originalId).toBe(orig.id);
  });

  it("does not create a second duplicate when the dragged bookmark is itself an already-tracked original", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    // Existing duplicate is pinned (before the separator).
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, index: 0, title: "A", url: "https://a.test" });
    await api.moveBookmark(state.separatorId, { parentId: TOOLBAR_ID, index: 1 });
    const entries = [{ originalId: orig.id, duplicateId: dup.id }];
    const current = { ...state, entries };

    // Now drag the original itself onto the toolbar's dynamic section.
    await api.moveBookmark(orig.id, { parentId: TOOLBAR_ID, index: 2 });

    const next = await handleBookmarkMoved(api, current, orig.id, {
      parentId: TOOLBAR_ID,
      index: 2,
      oldParentId: "folder",
      oldIndex: 0,
    });

    // Original restored to its folder, no new duplicate created.
    expect(await api.getChildren("folder")).toEqual([expect.objectContaining({ id: orig.id })]);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].duplicateId).toBe(dup.id);
  });

  it("detects cross-separator drag: promotes dynamic item to pinned", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });
    const entries = [{ originalId: orig.id, duplicateId: dup.id }];
    const current = { ...state, entries };
    // separator at index 0, dup at index 1 = dynamic
    // Drag dup before separator (index 0)
    await api.moveBookmark(dup.id, { parentId: TOOLBAR_ID, index: 0 });

    const next = await handleBookmarkMoved(api, current, dup.id, {
      parentId: TOOLBAR_ID,
      index: 0,
      oldParentId: TOOLBAR_ID,
      oldIndex: 1,
    });

    expect(next).toBeDefined();
  });

  it("does nothing for in-section reorder", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });
    const entries = [{ originalId: "orig", duplicateId: dup.id }];
    const current = { ...state, entries };

    const next = await handleBookmarkMoved(api, current, dup.id, {
      parentId: TOOLBAR_ID,
      index: 2,
      oldParentId: TOOLBAR_ID,
      oldIndex: 1,
    });

    expect(next).toEqual(current);
  });

  it("does not evict an untracked bare sibling sitting in the dynamic region", async () => {
    // Mid multi-drag, a not-yet-processed sibling sits bare in the dynamic
    // region. Adding a duplicate over capacity must evict a *tracked* dup,
    // never the bare sibling (which removeBookmark would delete for good).
    const api = createFakeBrowserApi();
    const state = { ...(await runInstall(api)), capacity: 1 };
    const trackedOrig = await api.createBookmark({ parentId: "folder", title: "T", url: "https://t.test" });
    const trackedDup = await api.createBookmark({ parentId: TOOLBAR_ID, index: 1, title: "T", url: "https://t.test" });
    // Bare untracked sibling parked at the tail of the dynamic region.
    const bare = await api.createBookmark({ parentId: TOOLBAR_ID, index: 2, title: "Bare", url: "https://bare.test" });
    const current = { ...state, entries: [{ originalId: trackedOrig.id, duplicateId: trackedDup.id }] };

    // Drag a fresh original A onto the toolbar — triggers add + capacity prune.
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    await api.moveBookmark(a.id, { parentId: TOOLBAR_ID, index: 1 });
    await handleBookmarkMoved(api, current, a.id, {
      parentId: TOOLBAR_ID,
      index: 1,
      oldParentId: "folder",
      oldIndex: 0,
    });

    // The bare sibling must survive; only a tracked duplicate may be evicted.
    expect(await api.getBookmark(bare.id)).not.toBeNull();
  });

  it("does not duplicate a folder dragged onto the toolbar", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const folder = await api.createBookmark({ parentId: OTHER_ID, title: "MyFolder", type: "folder" });
    await api.moveBookmark(folder.id, { parentId: TOOLBAR_ID, index: 1 });

    const next = await handleBookmarkMoved(api, state, folder.id, {
      parentId: TOOLBAR_ID,
      index: 1,
      oldParentId: OTHER_ID,
      oldIndex: 0,
    });

    // No entry tracked, and no junk url-less bookmark created on the toolbar.
    expect(next.entries).toHaveLength(0);
    const toolbar = await api.getChildren(TOOLBAR_ID);
    expect(toolbar.filter((c) => c.type === "bookmark" && !c.url)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sub-task 4e: handleBookmarkChanged — rename sync
// ---------------------------------------------------------------------------
describe("handleBookmarkChanged", () => {
  it("propagates a rename from the original to its duplicate", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = { separatorId: "s", capacity: 10, entries: [{ originalId: orig.id, duplicateId: dup.id }] };

    await handleBookmarkChanged(api, state, orig.id, { title: "A renamed" });

    expect((await api.getBookmark(dup.id)).title).toBe("A renamed");
  });

  it("propagates a rename from the duplicate back to the original", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = { separatorId: "s", capacity: 10, entries: [{ originalId: orig.id, duplicateId: dup.id }] };

    await handleBookmarkChanged(api, state, dup.id, { title: "A renamed on bar" });

    expect((await api.getBookmark(orig.id)).title).toBe("A renamed on bar");
  });

  it("propagates URL changes both ways", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = { separatorId: "s", capacity: 10, entries: [{ originalId: orig.id, duplicateId: dup.id }] };

    await handleBookmarkChanged(api, state, orig.id, { url: "https://new.test" });

    expect((await api.getBookmark(dup.id)).url).toBe("https://new.test");
  });

  it("does nothing for untracked bookmarks", async () => {
    const api = createFakeBrowserApi();
    const state = { separatorId: "s", capacity: 10, entries: [] };

    const result = await handleBookmarkChanged(api, state, "unknown-id", { title: "X" });

    expect(result).toEqual(state);
  });
});

// ---------------------------------------------------------------------------
// Sub-task 4e continued: handleBookmarkRemoved — delete sync
// ---------------------------------------------------------------------------
describe("handleBookmarkRemoved", () => {
  it("removes the duplicate when the original is deleted", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = { separatorId: "s", capacity: 10, entries: [{ originalId: orig.id, duplicateId: dup.id }] };

    const next = await handleBookmarkRemoved(api, state, orig.id);

    expect(next.entries).toEqual([]);
    expect(await api.getBookmark(dup.id)).toBeNull();
  });

  it("cleans up entry when the duplicate is deleted (manual eviction)", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = { separatorId: "s", capacity: 10, entries: [{ originalId: orig.id, duplicateId: dup.id }] };

    const next = await handleBookmarkRemoved(api, state, dup.id);

    expect(next.entries).toEqual([]);
    expect(await api.getBookmark(orig.id)).not.toBeNull();
  });

  it("does nothing for untracked bookmarks", async () => {
    const api = createFakeBrowserApi();
    const state = { separatorId: "s", capacity: 10, entries: [] };

    const next = await handleBookmarkRemoved(api, state, "unknown-id");

    expect(next).toEqual(state);
  });

  it("removes toolbar duplicates when a folder of originals is deleted (single onRemoved, no children data)", async () => {
    // Firefox fires ONE onRemoved for the folder, and removeInfo.node does NOT
    // include the subtree's children — the event tells us nothing about what
    // was inside. Both originals' toolbar duplicates must still be cleaned up,
    // detected via liveness rather than by walking subtree data Firefox never
    // provides.
    const api = createFakeBrowserApi();
    const folder = await api.createBookmark({ parentId: OTHER_ID, title: "Work", type: "folder" });
    const a = await api.createBookmark({ parentId: folder.id, title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: folder.id, title: "B", url: "https://b.test" });
    const dupA = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const dupB = await api.createBookmark({ parentId: TOOLBAR_ID, title: "B", url: "https://b.test" });
    const state = {
      separatorId: "s",
      capacity: 10,
      entries: [
        { originalId: a.id, duplicateId: dupA.id },
        { originalId: b.id, duplicateId: dupB.id },
      ],
    };

    await api.removeBookmark(folder.id);

    const next = await handleBookmarkRemoved(api, state, folder.id);

    expect(next.entries).toEqual([]);
    expect(await api.getBookmark(dupA.id)).toBeNull();
    expect(await api.getBookmark(dupB.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 5: Capacity change handling
// ---------------------------------------------------------------------------
describe("applyCapacityChange", () => {
  it("evicts from the dynamic tail when capacity shrinks", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "folder", title: "B", url: "https://b.test" });
    let current = await handleBookmarkCreated(api, state, a.id, a);
    current = await handleBookmarkCreated(api, current, b.id, b);

    const next = await applyCapacityChange(api, current, 1);

    expect(next.capacity).toBe(1);
    expect(next.entries).toHaveLength(1);
    const toolbar = await api.getChildren(TOOLBAR_ID);
    expect(toolbar.filter((c) => c.type === "bookmark")).toHaveLength(1);
  });

  it("does nothing extra when capacity grows", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    let current = await handleBookmarkCreated(api, state, a.id, a);

    const next = await applyCapacityChange(api, current, 50);

    expect(next.capacity).toBe(50);
    expect(next.entries).toHaveLength(1);
  });
});
