/**
 * Tracks the bookmark events that our own mutations are about to cause, so the
 * event listeners can ignore them. The browser fires bookmark events for every
 * change — including ours — and never says who caused them. Without this, our
 * rename-sync would update the counterpart, receive the echoed onChanged, and
 * sync it back forever. We give our mutations provenance by tagging them.
 *
 * Keys are `"<type>:<id>"`. Bounded so a dropped/coalesced event can't leak
 * memory: oldest marks are evicted past `max`.
 */
export function createExpectedSet(max = 200) {
  const keys = new Set(); // insertion-ordered
  function mark(type, id) {
    const key = `${type}:${id}`;
    keys.delete(key); // refresh recency if already present
    keys.add(key);
    while (keys.size > max) {
      const oldest = keys.values().next().value;
      keys.delete(oldest);
    }
  }
  function consume(type, id) {
    return keys.delete(`${type}:${id}`);
  }
  function size() {
    return keys.size;
  }
  return { mark, consume, size };
}

/**
 * Wraps a browser-api adapter so every mutation records an expected event in
 * `expected`. Handlers keep calling `api.createBookmark(...)` etc. unchanged —
 * pass them the tracking api instead of the raw adapter.
 */
export function createTrackingApi(api, expected) {
  return {
    ...api,
    async createBookmark(args) {
      const node = await api.createBookmark(args);
      expected.mark("created", node.id);
      return node;
    },
    removeBookmark(id) {
      expected.mark("removed", id);
      return api.removeBookmark(id);
    },
    moveBookmark(id, dest) {
      expected.mark("moved", id);
      return api.moveBookmark(id, dest);
    },
    updateBookmark(id, changes) {
      expected.mark("changed", id);
      return api.updateBookmark(id, changes);
    },
  };
}
