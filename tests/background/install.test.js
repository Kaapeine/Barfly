import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID, OTHER_ID } from "../../src/platform/firefox-browser-api.js";
import { runInstall } from "../../src/background/install.js";

describe("runInstall", () => {
  it("creates a separator and default state when the toolbar is empty", async () => {
    const api = createFakeBrowserApi();
    const now = new Date('2026-06-20T00:00:00Z');

    const state = await runInstall(api, now);

    expect(state.separatorId).toBeDefined();
    expect(state.capacity).toBe(10);
    expect(state.entries).toEqual([]);

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren).toEqual([
      expect.objectContaining({ id: state.separatorId, type: "separator" }),
    ]);
  });

  it('archives existing toolbar contents under Other Bookmarks', async () => {
    const api = createFakeBrowserApi();
    const first = await api.createBookmark({
      parentId: TOOLBAR_ID,
      title: 'First',
      url: 'https://first.test',
    });
    const second = await api.createBookmark({
      parentId: TOOLBAR_ID,
      title: 'Second',
      url: 'https://second.test',
    });
    const now = new Date('2026-06-20T00:00:00Z');

    await runInstall(api, now);

    const otherChildren = await api.getChildren(OTHER_ID);
    expect(otherChildren).toHaveLength(1);
    const archiveFolder = otherChildren[0];
    expect(archiveFolder.title).toBe(
      'Bookmarks Toolbar archived on 2026-06-20',
    );
    expect(archiveFolder.type).toBe('folder');

    const archived = await api.getChildren(archiveFolder.id);
    expect(archived.map((n) => n.id)).toEqual([first.id, second.id]);

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren).toHaveLength(1);
    expect(toolbarChildren[0].type).toBe('separator');
  });

  it("is idempotent: does nothing if state already exists", async () => {
    const api = createFakeBrowserApi();
    const now = new Date('2026-06-20T00:00:00Z');
    const first = await runInstall(api, now);

    const second = await runInstall(api, now);

    expect(second).toEqual(first);
    expect(await api.getChildren(OTHER_ID)).toEqual([]);
  });
});