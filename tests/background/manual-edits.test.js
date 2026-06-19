import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID, OTHER_ID } from "../../src/platform/firefox-browser-api.js";
import { createDefaultState } from "../../src/core/state.js";
import { handleBookmarkCreated, handleBookmarkMoved } from "../../src/background/manual-edits.js";

async function setupSeparator(api) {
  const separator = await api.createBookmark({ parentId: TOOLBAR_ID, type: "separator" });
  return separator.id;
}

describe("handleBookmarkCreated", () => {
  it("relocates a bookmark created directly on the toolbar to Other Bookmarks and promotes it to dynamic", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const state = createDefaultState({ separatorId, capacity: 5 });
    const node = await api.createBookmark({ parentId: TOOLBAR_ID, index: 1, title: "A", url: "https://a.test" });

    const next = await handleBookmarkCreated(api, state, node.id, node);

    expect(Object.keys(next.dynamicMap)).toEqual([node.id]);
    const otherChildren = await api.getChildren(OTHER_ID);
    expect(otherChildren.map((n) => n.id)).toEqual([node.id]);
  });

  it("promotes a bookmark created in any other folder straight to dynamic, without relocating it", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const state = createDefaultState({ separatorId, capacity: 5 });
    const node = await api.createBookmark({ parentId: "work-folder", title: "A", url: "https://a.test" });

    const next = await handleBookmarkCreated(api, state, node.id, node);

    expect(Object.keys(next.dynamicMap)).toEqual([node.id]);
    expect(await api.getChildren("work-folder")).toEqual([expect.objectContaining({ id: node.id })]);
  });
});

describe("handleBookmarkMoved", () => {
  it("drags an untracked bookmark from a folder onto the dynamic region: relocates back and promotes to dynamic", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const state = createDefaultState({ separatorId, capacity: 5 });
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    await api.moveBookmark(original.id, { parentId: TOOLBAR_ID, index: 1 });

    const next = await handleBookmarkMoved(api, state, original.id, {
      parentId: TOOLBAR_ID,
      index: 1,
      oldParentId: "folder",
      oldIndex: 0,
    });

    expect(Object.keys(next.dynamicMap)).toEqual([original.id]);
    expect(await api.getChildren("folder")).toEqual([expect.objectContaining({ id: original.id })]);
  });

  it("drags an untracked bookmark onto the pinned region: relocates back and promotes to pinned", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const state = createDefaultState({ separatorId, pinnedFolderId: "pinned-folder", capacity: 5 });
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    await api.moveBookmark(original.id, { parentId: TOOLBAR_ID, index: 0 });

    const next = await handleBookmarkMoved(api, state, original.id, {
      parentId: TOOLBAR_ID,
      index: 0,
      oldParentId: "folder",
      oldIndex: 0,
    });

    expect(Object.keys(next.pinnedMap)).toHaveLength(1);
    expect(await api.getChildren("folder")).toEqual([expect.objectContaining({ id: original.id })]);
    const pinnedFolderChildren = await api.getChildren("pinned-folder");
    expect(pinnedFolderChildren.map((n) => n.url)).toEqual(["https://a.test"]);
  });

  it("drags a tracked dynamic duplicate across the separator into the pinned region: promotes", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = createDefaultState({
      separatorId,
      pinnedFolderId: "pinned-folder",
      capacity: 5,
      dynamicMap: { [original.id]: dup.id },
    });
    await api.moveBookmark(dup.id, { parentId: TOOLBAR_ID, index: 0 });

    const next = await handleBookmarkMoved(api, state, dup.id, {
      parentId: TOOLBAR_ID,
      index: 0,
      oldParentId: TOOLBAR_ID,
      oldIndex: 1,
    });

    expect(next.dynamicMap).toEqual({});
    expect(Object.keys(next.pinnedMap)).toHaveLength(1);
    const pinnedFolderChildren = await api.getChildren("pinned-folder");
    expect(pinnedFolderChildren.map((n) => n.url)).toEqual(["https://a.test"]);
  });

  it("drags a tracked pinned duplicate across the separator into the dynamic region: demotes", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const original = await api.createBookmark({ parentId: "pinned-folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, index: 0, title: "A", url: "https://a.test" });
    const state = createDefaultState({
      separatorId,
      pinnedFolderId: "pinned-folder",
      capacity: 5,
      pinnedMap: { [original.id]: dup.id },
    });
    await api.moveBookmark(dup.id, { parentId: TOOLBAR_ID, index: 2 });

    const next = await handleBookmarkMoved(api, state, dup.id, {
      parentId: TOOLBAR_ID,
      index: 2,
      oldParentId: TOOLBAR_ID,
      oldIndex: 0,
    });

    expect(next.pinnedMap).toEqual({});
    expect(Object.keys(next.dynamicMap)).toEqual([original.id]);
    const otherChildren = await api.getChildren(OTHER_ID);
    expect(otherChildren.map((n) => n.id)).toEqual([original.id]);
  });

  it("does nothing when a tracked dynamic duplicate is reordered within its own section", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, index: 1, title: "A", url: "https://a.test" });
    const other = await api.createBookmark({ parentId: TOOLBAR_ID, index: 2, title: "B", url: "https://b.test" });
    const state = createDefaultState({
      separatorId,
      capacity: 5,
      dynamicMap: { [original.id]: dup.id },
    });
    await api.moveBookmark(dup.id, { parentId: TOOLBAR_ID, index: 2 });

    const next = await handleBookmarkMoved(api, state, dup.id, {
      parentId: TOOLBAR_ID,
      index: 2,
      oldParentId: TOOLBAR_ID,
      oldIndex: 1,
    });

    expect(next).toEqual(state);
  });
});
