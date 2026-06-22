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
 * Owns the mutable runtime (state + paused) and wires browser events through
 * the serial queue and self-event suppression into the pure handlers.
 *
 * `api` is the raw adapter (used for listeners + setState). Handlers receive a
 * tracking wrapper so every mutation they perform is marked as expected and the
 * echoed event is ignored.
 */
export function createDispatcher(api) {
  const queue = createSerialQueue();
  const expected = createExpectedSet();
  const trackingApi = createTrackingApi(api, expected);
  let state = null;
  let paused = false;

  function run(type, handler) {
    return (...args) =>
      queue.enqueue(async () => {
        const id = args[0];
        if (paused) return;
        if (expected.consume(type, id)) return; // our own mutation — ignore
        state = await handler(...args);
        await api.setState(state);
      });
  }

  function registerEventHandlers() {
    api.onUrlVisited(
      // onVisited has no id to suppress; it never reflects our own writes.
      ({ url }) =>
        queue.enqueue(async () => {
          if (paused) return;
          state = await handleVisit(trackingApi, state, url);
          await api.setState(state);
        }),
    );
    api.onBookmarkCreated(
      run("created", (id, node) => handleBookmarkCreated(trackingApi, state, id, node)),
    );
    api.onBookmarkMoved(
      run("moved", (id, moveInfo) => handleBookmarkMoved(trackingApi, state, id, moveInfo)),
    );
    api.onBookmarkChanged(
      run("changed", (id, changeInfo) => handleBookmarkChanged(trackingApi, state, id, changeInfo)),
    );
    api.onBookmarkRemoved(
      run("removed", (id) => handleBookmarkRemoved(trackingApi, state, id)),
    );
  }

  return {
    registerEventHandlers,
    queue,
    trackingApi,
    getState: () => state,
    setState: (s) => { state = s; },
    setPaused: (p) => { paused = p; },
    isPaused: () => paused,
    // Test/util helper: resolve once the queue has drained.
    drain: () => queue.enqueue(async () => {}),
  };
}
