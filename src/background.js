import * as api from './platform/browser-api.js';
import { createSuppressionGuard } from './core/guard.js';
import { runInstall } from './background/install.js';
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
} from './background/events.js';

const guard = createSuppressionGuard();
let state;
let paused = false;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function init() {
  const setupComplete = await api.getSetupComplete();

  if (!setupComplete) {
    // Enter setup mode — only listen for install events and setupComplete message.
    api.onInstalled(async ({ reason }) => {
      console.log('On Install');
      if (reason === 'install') {
        await api.openTab('src/options/release/options.html');
      }
    });

    api.onMessage((message) => {
      if (message.type !== 'setupComplete') return undefined;

      // Return a promise only for the setupComplete message
      return (async () => {
        console.log('wizard complete');
        state = await runInstall(api, message.capacity);
        await api.setState(state);
        await api.setSetupComplete(true);
        // Register message handlers so options page can fetch settings
        registerMessageHandlers();
        startExtension();
        return { ok: true };
      })();
    });

    return;
  }

  // Normal startup — setup is complete
  // Register message handlers immediately so options page can talk to us
  registerMessageHandlers();

  const { state: resolved } = await resolveInitState(api);

  if (!resolved) {
    // Case 4: state + separator both missing despite setupComplete flag.
    // This shouldn't happen in practice, but if it does, re-enter setup mode.
    console.log('Case 4: no state or seperator');
    await api.setSetupComplete(false);
    await api.openTab('src/options/release/options.html');
    return;
  }

  state = resolved;

  const result = await rebuildFromToolbar(api, state);
  state = { ...result.state, entries: result.entries };
  await api.setState(state);
  startExtension();
}

// ---------------------------------------------------------------------------
// Start the extension — register all event listeners and context menu
// ---------------------------------------------------------------------------

function startExtension() {
  // Register context menu
  api.createContextMenu({
    id: 'bookmark-bar-lru-toggle-pin',
    title: 'Pin to bar',
    contexts: ['bookmark'],
  });

  // Bookmark & history events
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

  // Context menu: update title on show
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
}

// ---------------------------------------------------------------------------
// Register message handlers for options page communication
// ---------------------------------------------------------------------------

function registerMessageHandlers() {
  api.onMessage(async (message) => {
    return guard.run(async () => {
      switch (message.type) {
        case 'getSettings':
          return { capacity: state?.capacity ?? 10 };
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
}

init();
