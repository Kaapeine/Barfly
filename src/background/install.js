import { TOOLBAR_ID, OTHER_ID } from "../platform/firefox-browser-api.js";
import { createDefaultState } from "../core/state.js";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export async function runInstall(api, now = new Date()) {
  const existing = await api.getState();
  if (existing) return existing;

  const toolbarChildren = await api.getChildren(TOOLBAR_ID);

  if (toolbarChildren.length > 0) {
    const archiveFolder = await api.createBookmark({
      parentId: OTHER_ID,
      title: `Bookmarks Toolbar archived on ${formatDate(now)}`,
      type: "folder",
    });
    for (const child of toolbarChildren) {
      await api.moveBookmark(child.id, { parentId: archiveFolder.id });
    }
  }

  const separator = await api.createBookmark({
    parentId: TOOLBAR_ID,
    index: 0,
    type: "separator",
  });

  const state = createDefaultState({ separatorId: separator.id });
  await api.setState(state);
  return state;
}