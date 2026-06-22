import * as api from './platform/browser-api.js';
import { runInstall } from './background/install.js';
import { resolveInitState } from './core/init.js';
import { rebuildFromToolbar, applyCapacityChange, getContextMenuTitle, handleContextMenuTogglePin } from './background/events.js';
import { createDispatcher } from './background/dispatch.js';

const dispatcher = createDispatcher(api);

// ---------------------------------------------------------------------------
// Module-level listeners (registered synchronously before any await)
// ---------------------------------------------------------------------------

api.onInstalled(async ({ reason }) => {
  console.log('On Install');
  if (reason === 'install') {
    const setupComplete = await api.getSetupComplete();
    if (!setupComplete) {
      await api.openTab('src/options/options.html');
    }
  }
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function init() {
  const setupComplete = await api.getSetupComplete();

  if (!setupComplete) {
    // Enter setup mode — only listen for install events and setupComplete message.
    console.log('setup mode enter');
    enterSetupMode();
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
    enterSetupMode();
    return;
  }

  const result = await rebuildFromToolbar(api, resolved);
  dispatcher.setState({ ...result.state, entries: result.entries });
  await api.setState(dispatcher.getState());
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
  dispatcher.registerEventHandlers();

  // Context menu: update title on show
  api.onContextMenuShown(async (info) => {
    if (info.menuIds.indexOf('bookmark-bar-lru-toggle-pin') === -1) return;
    const title = await getContextMenuTitle(api, dispatcher.getState(), info.bookmarkId);
    api.updateContextMenu('bookmark-bar-lru-toggle-pin', { title });
    api.refreshContextMenu();
  });

  api.onContextMenuClicked(async (info) => {
    if (info.menuItemId !== 'bookmark-bar-lru-toggle-pin') return;
    await dispatcher.queue.enqueue(async () => {
      const next = await handleContextMenuTogglePin(dispatcher.trackingApi, dispatcher.getState(), info.bookmarkId);
      dispatcher.setState(next);
      await api.setState(next);
    });
  });
}

// ---------------------------------------------------------------------------
// Register message handlers for options page communication
// ---------------------------------------------------------------------------

function registerMessageHandlers() {
  api.onMessage(async (message) => {
    return dispatcher.queue.enqueue(async () => {
      switch (message.type) {
        case 'getSettings':
          return { capacity: dispatcher.getState()?.capacity ?? 10 };
        case 'setCapacity': {
          const next = await applyCapacityChange(dispatcher.trackingApi, dispatcher.getState(), message.capacity);
          dispatcher.setState(next);
          await api.setState(next);
          return { ok: true };
        }
        case 'rebuild': {
          const result = await rebuildFromToolbar(api, dispatcher.getState());
          dispatcher.setState({ ...result.state, entries: result.entries });
          await api.setState(dispatcher.getState());
          return { ok: true };
        }
        case 'setPaused':
          dispatcher.setPaused(message.paused);
          return { ok: true };
        default:
          return undefined;
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Enter setup mode — open the wizard and listen for completion
// ---------------------------------------------------------------------------

async function enterSetupMode() {
  // Open the wizard tab
  await api.openTab('src/options/options.html');

  api.onMessage((message) => {
    if (message.type !== 'setupComplete') return undefined;

    // Return a promise only for the setupComplete message
    return (async () => {
      console.log('wizard complete');
      dispatcher.setState(await runInstall(api, message.capacity));
      await api.setState(dispatcher.getState());
      await api.setSetupComplete(true);
      // Register message handlers so options page can fetch settings
      registerMessageHandlers();
      startExtension();
      return { ok: true };
    })();
  });
}

init();
