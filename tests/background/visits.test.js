import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID } from "../../src/platform/firefox-browser-api.js";
import { createDefaultState } from "../../src/core/state.js";
import { handleVisit } from "../../src/background/visits.js";

async function setupSeparator(api) {
  const separator = await api.createBookmark({ parentId: TOOLBAR_ID, type: "separator" });
  return separator.id;
}

describe("handleVisit", () => {
  it("does nothing when the URL matches no bookmark", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const state = createDefaultState({ separatorId, capacity: 5 });

    const next = await handleVisit(api, state, "https://nowhere.test");

    expect(next).toEqual(state);
  });

  it("does nothing when the URL matches an already-pinned original", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const duplicate = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = createDefaultState({
      separatorId,
      capacity: 5,
      pinnedMap: { [original.id]: duplicate.id },
    });

    const next = await handleVisit(api, state, "https://a.test");

    expect(next).toEqual(state);
  });

  it("creates a dynamic duplicate for a freshly visited, untracked bookmark", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const state = createDefaultState({ separatorId, capacity: 5 });

    const next = await handleVisit(api, state, "https://a.test");

    expect(Object.keys(next.dynamicMap)).toEqual([original.id]);
    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.id)).toEqual([separatorId, next.dynamicMap[original.id]]);
  });

  it("moves an already-dynamic item to the front on revisit", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "folder", title: "B", url: "https://b.test" });
    let state = createDefaultState({ separatorId, capacity: 5 });
    state = await handleVisit(api, state, "https://a.test");
    state = await handleVisit(api, state, "https://b.test");

    state = await handleVisit(api, state, "https://a.test");

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.id)).toEqual([
      separatorId,
      state.dynamicMap[a.id],
      state.dynamicMap[b.id],
    ]);
  });

  it("evicts the least-recent dynamic duplicate when capacity is exceeded", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "folder", title: "B", url: "https://b.test" });
    let state = createDefaultState({ separatorId, capacity: 1 });
    state = await handleVisit(api, state, "https://a.test");

    state = await handleVisit(api, state, "https://b.test");

    expect(Object.keys(state.dynamicMap)).toEqual([b.id]);
    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.id)).toEqual([separatorId, state.dynamicMap[b.id]]);
  });

  it("does not create duplicate dynamic entries when the same URL is bookmarked in multiple folders", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const a = await api.createBookmark({ parentId: "folder-1", title: "A", url: "https://same.test" });
    const b = await api.createBookmark({ parentId: "folder-2", title: "A also", url: "https://same.test" });
    let state = createDefaultState({ separatorId, capacity: 5 });

    state = await handleVisit(api, state, "https://same.test");

    expect(Object.keys(state.dynamicMap)).toHaveLength(1);
  });
});
