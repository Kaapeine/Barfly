/**
 * Tracks the bookmark events that our own mutations are about to cause, so the
 * event listeners can ignore them. The browser fires bookmark events for every
 * change — including ours — and never says who caused them. Without this, our
 * rename-sync would update the counterpart, receive the echoed onChanged, and
 * sync it back forever. We give our mutations provenance by tagging them.
 *
 * Persisted through `api.getExpectedEvents`/`setExpectedEvents` (backed by
 * session storage) rather than an in-memory Set, so a mark survives an MV3
 * service-worker restart between marking a mutation and its echo arriving.
 *
 * Keys are `"<type>:<id>"`. Bounded so a dropped/coalesced event can't leak
 * storage: oldest marks are evicted past `max`.
 */
export function createExpectedSet(api, max = 200) {
  async function mark(type, id) {
    const key = `${type}:${id}`;
    const keys = (await api.getExpectedEvents()).filter((k) => k !== key);
    keys.push(key);
    while (keys.length > max) keys.shift();
    await api.setExpectedEvents(keys);
  }
  async function consume(type, id) {
    const key = `${type}:${id}`;
    const keys = await api.getExpectedEvents();
    const idx = keys.indexOf(key);
    if (idx === -1) return false;
    keys.splice(idx, 1);
    await api.setExpectedEvents(keys);
    return true;
  }
  async function size() {
    return (await api.getExpectedEvents()).length;
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
      await expected.mark("created", node.id);
      return node;
    },
    async removeBookmark(id) {
      await expected.mark("removed", id);
      return api.removeBookmark(id);
    },
    async moveBookmark(id, dest) {
      await expected.mark("moved", id);
      return api.moveBookmark(id, dest);
    },
    async updateBookmark(id, changes) {
      await expected.mark("changed", id);
      return api.updateBookmark(id, changes);
    },
  };
}
