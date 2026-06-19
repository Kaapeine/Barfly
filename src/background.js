import * as api from "./platform/firefox-browser-api.js";
import { TOOLBAR_ID } from "./platform/firefox-browser-api.js";
import { createSuppressionGuard } from "./core/guard.js";
import { runInstall } from "./background/install.js";
import {
  rebuildFromToolbar,
  handleVisit,
  handleBookmarkCreated,
  handleBookmarkMoved,
  handleBookmarkChanged,
  handleBookmarkRemoved,
  applyCapacityChange,
  getContextMenuTitle,
  handleContextMenuTogglePin,
} from "./background/events.js";

const guard = createSuppressionGuard();
let state;
let setupError = null;

// One-time initialization: install, then sync state with the toolbar
const ready = guard.run(async () => {
  try {
    state = await runInstall(api);
    const entries = await rebuildFromToolbar(api, state);
    if (entries.length > 0) {
      state = { ...state, entries };
      await api.setState(state);
    }

    // Register context menu (done inside ready so errors don't block listeners)
    await browser.contextMenus.create({
      id: "bookmark-bar-lru-toggle-pin",
      title: "Pin to bar",
      contexts: ["bookmark"],
    });
  } catch (err) {
    setupError = err;
    console.error("BarFly setup error:", err);
  }
});

// ---------------------------------------------------------------------------
// Event listeners — skip events triggered by our own mutations
// ---------------------------------------------------------------------------

api.onUrlVisited(async ({ url }) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleVisit(api, state, url);
    await api.setState(state);
  });
});

api.onBookmarkCreated(async (id, node) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkCreated(api, state, id, node);
    await api.setState(state);
  });
});

api.onBookmarkMoved(async (id, moveInfo) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkMoved(api, state, id, moveInfo);
    await api.setState(state);
  });
});

api.onBookmarkChanged(async (id, changeInfo) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkChanged(api, state, id, changeInfo);
    await api.setState(state);
  });
});

api.onBookmarkRemoved(async (id, removeInfo) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkRemoved(api, state, id);
    await api.setState(state);
  });
});

// ---------------------------------------------------------------------------
// Context menu: toggle pin / unpin
// (menu item created inside ready() in initialization above)
// ---------------------------------------------------------------------------

// Update menu title based on whether the clicked bookmark is pinned or dynamic
browser.contextMenus.onShown.addListener(async (info) => {
  if (info.menuIds.indexOf("bookmark-bar-lru-toggle-pin") === -1) return;
  await ready;
  const title = await getContextMenuTitle(api, state, info.bookmarkId);
  browser.contextMenus.update("bookmark-bar-lru-toggle-pin", { title });
  browser.contextMenus.refresh();
});

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "bookmark-bar-lru-toggle-pin") return;
  await ready;
  await guard.run(async () => {
    state = await handleContextMenuTogglePin(api, state, info.bookmarkId);
    await api.setState(state);
  });
});

// ---------------------------------------------------------------------------
// Options / messaging
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener(async (message) => {
  await ready;
  return guard.run(async () => {
    switch (message.type) {
      case "getSettings":
        return { capacity: state.capacity };
      case "setCapacity":
        state = await applyCapacityChange(api, state, message.capacity);
        await api.setState(state);
        return { ok: true };
      case "rebuild": {
        const entries = await rebuildFromToolbar(api, state);
        state = { ...state, entries };
        await api.setState(state);
        return { ok: true };
      }
      default:
        return undefined;
    }
  });
});