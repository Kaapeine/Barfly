import * as api from "./platform/firefox-browser-api.js";
import { TOOLBAR_ID } from "./platform/firefox-browser-api.js";
import { createSuppressionGuard } from "./core/guard.js";
import { runInstall } from "./background/install.js";
import { resolveInitState } from './core/init.js';
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
let paused = false;

// On every background-script load: handle 4 cases based on state & separator
const ready = guard.run(async () => {
  try {
    const { state: resolved } = await resolveInitState(api, { runInstall });
    state = resolved;

    const result = await rebuildFromToolbar(api, state);
    state = { ...result.state, entries: result.entries };
    await api.setState(state);

    // Register context menu (done inside ready so errors don't block listeners)
    await api.createContextMenu({
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
  if (paused || guard.isSuppressed()) return;
  await guard.run(async () => {
    state = await handleVisit(api, state, url);
    await api.setState(state);
  });
});

api.onBookmarkCreated(async (id, node) => {
  if (paused || guard.isSuppressed()) return;
  await guard.run(async () => {
    state = await handleBookmarkCreated(api, state, id, node);
    await api.setState(state);
  });
});

api.onBookmarkMoved(async (id, moveInfo) => {
  if (paused || guard.isSuppressed()) return;
  await guard.run(async () => {
    state = await handleBookmarkMoved(api, state, id, moveInfo);
    await api.setState(state);
  });
});

api.onBookmarkChanged(async (id, changeInfo) => {
  if (paused || guard.isSuppressed()) return;
  await guard.run(async () => {
    state = await handleBookmarkChanged(api, state, id, changeInfo);
    await api.setState(state);
  });
});

api.onBookmarkRemoved(async (id, removeInfo) => {
  if (paused || guard.isSuppressed()) return;
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
api.onContextMenuShown(async (info) => {
  if (info.menuIds.indexOf('bookmark-bar-lru-toggle-pin') === -1) return;
  const title = await getContextMenuTitle(api, state, info.bookmarkId);
  api.updateContextMenu('bookmark-bar-lru-toggle-pin', { title });
  api.refreshContextMenu();
});

api.onContextMenuClicked(async (info) => {
  if (info.menuItemId !== 'bookmark-bar-lru-toggle-pin') return;
  await guard.run(async () => {
    state = await handleContextMenuTogglePin(api, state, info.bookmarkId);
    await api.setState(state);
  });
});

// ---------------------------------------------------------------------------
// Options / messaging
// ---------------------------------------------------------------------------

api.onMessage(async (message) => {
  return guard.run(async () => {
    switch (message.type) {
      case 'getSettings':
        return { capacity: state.capacity };
      case 'setCapacity':
        state = await applyCapacityChange(api, state, message.capacity);
        await api.setState(state);
        return { ok: true };
      case 'rebuild': {
        const result = await rebuildFromToolbar(api, state);
        state = { ...result.state, entries: result.entries };
        await api.setState(state);
        return { ok: true };
      }
      case 'setPaused':
        paused = message.paused;
        return { ok: true };
      default:
        return undefined;
    }
  });
});