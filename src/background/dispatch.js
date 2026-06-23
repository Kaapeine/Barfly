import { createSerialQueue } from "../core/queue.js";
import { createExpectedSet, createTrackingApi } from "../core/suppression.js";
import {
  handleVisit,
  handleBookmarkCreated,
  handleBookmarkMoved,
  handleBookmarkChanged,
  handleBookmarkRemoved,
} from "./events.js";

/**
 * Wires browser events through the serial queue and self-event suppression
 * into the pure handlers. Holds no runtime state of its own — `state` and
 * `paused` are read from and written to `api` on every single dispatch, since
 * an MV3 service worker can be killed and respawned between any two events,
 * silently wiping anything cached only in a JS variable.
 *
 * `api` is the raw adapter (used for listeners + getState/setState). Handlers
 * receive a tracking wrapper so every mutation they perform is marked as
 * expected and the echoed event is ignored.
 */
export function createDispatcher(api) {
  const queue = createSerialQueue();
  const expected = createExpectedSet(api);
  const trackingApi = createTrackingApi(api, expected);

  function run(type, handler) {
    return (...args) =>
      queue.enqueue(async () => {
        const id = args[0];
        if (await api.getPaused()) return;
        if (await expected.consume(type, id)) return; // our own mutation — ignore
        const state = await api.getState();
        if (!state) return; // setup not finished yet — nothing to update
        const next = await handler(state, ...args);
        await api.setState(next);
      });
  }

  function registerEventHandlers() {
    api.onUrlVisited(
      // onVisited has no id to suppress; it never reflects our own writes.
      ({ url }) =>
        queue.enqueue(async () => {
          if (await api.getPaused()) return;
          const state = await api.getState();
          if (!state) return; // setup not finished yet — nothing to update
          const next = await handleVisit(trackingApi, state, url);
          await api.setState(next);
        }),
    );
    api.onBookmarkCreated(
      run("created", (state, id, node) => handleBookmarkCreated(trackingApi, state, id, node)),
    );
    api.onBookmarkMoved(
      run("moved", (state, id, moveInfo) => handleBookmarkMoved(trackingApi, state, id, moveInfo)),
    );
    api.onBookmarkChanged(
      run("changed", (state, id, changeInfo) => handleBookmarkChanged(trackingApi, state, id, changeInfo)),
    );
    api.onBookmarkRemoved(
      run("removed", (state, id, removeInfo) => handleBookmarkRemoved(trackingApi, state, id, removeInfo)),
    );
  }

  return {
    registerEventHandlers,
    queue,
    trackingApi,
    getState: () => api.getState(),
    setState: (s) => api.setState(s),
    setPaused: (p) => api.setPaused(p),
    isPaused: () => api.getPaused(),
    // Test/util helper: resolve once the queue has drained.
    drain: () => queue.enqueue(async () => {}),
  };
}
