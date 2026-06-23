import * as api from './platform/browser-api.js';
import { runInstall } from './background/install.js';
import { resolveInitState } from './core/init.js';
import { rebuildFromToolbar, applyCapacityChange, getContextMenuTitle, handleContextMenuTogglePin } from './background/events.js';
import { createDispatcher } from './background/dispatch.js';

const dispatcher = createDispatcher(api);

// ---------------------------------------------------------------------------
// Register everything synchronously, before any await. Under MV3 the
// background page is a non-persistent event page that can be unloaded and
// woken back up between events — listeners only get treated as wake-eligible
// if they're added during the initial, synchronous script evaluation, not
// buried inside an async chain. Every handler below tolerates dispatcher
// state being null (setup not finished yet) by no-op'ing rather than
// crashing, since events can arrive before init()'s async work resolves.
// ---------------------------------------------------------------------------

dispatcher.registerEventHandlers();

api.createContextMenu({
  id: 'bookmark-bar-lru-toggle-pin',
  title: 'Pin to bar',
  contexts: ['bookmark'],
});

api.onContextMenuShown(async (info) => {
  if (info.menuIds.indexOf('bookmark-bar-lru-toggle-pin') === -1) return;
  const state = await dispatcher.getState();
  if (!state) return;
  const title = await getContextMenuTitle(api, state, info.bookmarkId);
  api.updateContextMenu('bookmark-bar-lru-toggle-pin', { title });
  api.refreshContextMenu();
});

api.onContextMenuClicked(async (info) => {
  if (info.menuItemId !== 'bookmark-bar-lru-toggle-pin') return;
  await dispatcher.queue.enqueue(async () => {
    const state = await dispatcher.getState();
    if (!state) return;
    const next = await handleContextMenuTogglePin(dispatcher.trackingApi, state, info.bookmarkId);
    await dispatcher.setState(next);
  });
});

api.onMessage((message) => {
  return dispatcher.queue.enqueue(async () => {
    switch (message.type) {
      case 'setupComplete': {
        await dispatcher.setState(await runInstall(api, message.capacity));
        await api.setSetupComplete(true);
        return { ok: true };
      }
      case 'getSettings': {
        const state = await dispatcher.getState();
        return { capacity: state?.capacity ?? 10 };
      }
      case 'setCapacity': {
        const state = await dispatcher.getState();
        if (!state) return { ok: false };
        const next = await applyCapacityChange(dispatcher.trackingApi, state, message.capacity);
        await dispatcher.setState(next);
        return { ok: true };
      }
      case 'rebuild': {
        const state = await dispatcher.getState();
        if (!state) return { ok: false };
        // tracking api: rebuild may create backing originals while adopting
        // orphan toolbar bookmarks; their onCreated echoes must be suppressed.
        const result = await rebuildFromToolbar(dispatcher.trackingApi, state);
        await dispatcher.setState({ ...result.state, entries: result.entries });
        return { ok: true };
      }
      case 'setPaused':
        await dispatcher.setPaused(message.paused);
        return { ok: true };
      default:
        return undefined;
    }
  });
});

// ---------------------------------------------------------------------------
// Async setup — runs after listeners are already live, so nothing here gates
// whether events get caught.
// ---------------------------------------------------------------------------

async function init() {
  const setupComplete = await api.getSetupComplete();

  if (!setupComplete) {
    await api.openTab('src/options/options.html');
    return;
  }

  const { state: resolved } = await resolveInitState(api);

  if (!resolved) {
    // Case 4: state + separator both missing despite setupComplete flag.
    // This shouldn't happen in practice, but if it does, re-enter setup mode.
    await api.setSetupComplete(false);
    await api.openTab('src/options/options.html');
    return;
  }

  // Run through the dispatcher's queue, not directly: a wake-up can coincide
  // with in-flight bookmark events (e.g. the multi-item drag that woke this
  // worker). Racing them lets rebuildFromToolbar see a dragged bookmark
  // sitting bare on the toolbar — not yet split into original+duplicate by
  // the queued handler — and delete it as a false "orphan".
  await dispatcher.queue.enqueue(async () => {
    const result = await rebuildFromToolbar(dispatcher.trackingApi, resolved);
    await dispatcher.setState({ ...result.state, entries: result.entries });
  });
}

init();
