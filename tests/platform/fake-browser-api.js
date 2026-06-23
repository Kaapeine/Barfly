export function createFakeBrowserApi() {
  let nextId = 1;
  const nodes = new Map();
  const listeners = { created: [], removed: [], changed: [], moved: [], visited: [] };
  let state = null;
  let expectedEvents = [];
  let paused = false;

  function childrenOf(parentId) {
    return [...nodes.values()]
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.index - b.index);
  }

  function reindex(parentId) {
    childrenOf(parentId).forEach((n, i) => {
      n.index = i;
    });
  }

  function deleteSubtree(id) {
    for (const child of childrenOf(id)) deleteSubtree(child.id);
    nodes.delete(id);
  }

  return {
    async createBookmark({ parentId, index, title, url, type = 'bookmark' }) {
      const id = String(nextId++);
      const siblings = childrenOf(parentId);
      const at = index ?? siblings.length;
      for (const s of siblings) if (s.index >= at) s.index += 1;
      const node = { id, parentId, index: at, title, url, type };
      nodes.set(id, node);
      listeners.created.forEach((cb) => cb(id, { ...node }));
      return { ...node };
    },

    async removeBookmark(id) {
      const node = nodes.get(id);
      if (!node) return;
      // Mirror Firefox: removing a folder fires a SINGLE onRemoved for the
      // top node and none for its contents — and removeInfo.node does NOT
      // include the subtree's children, so callers can't recover what was
      // inside from the event itself.
      const { children, ...nodeWithoutChildren } = node;
      deleteSubtree(id);
      reindex(node.parentId);
      listeners.removed.forEach((cb) =>
        cb(id, { parentId: node.parentId, index: node.index, node: { ...nodeWithoutChildren } }),
      );
    },

    async moveBookmark(id, { parentId, index }) {
      const node = nodes.get(id);
      const oldParentId = node.parentId;
      const oldIndex = node.index;

      node.parentId = null;
      reindex(oldParentId);

      node.parentId = parentId;
      const siblings = childrenOf(parentId);
      const targetIndex = index ?? siblings.length;
      for (const s of siblings) {
        if (s.index >= targetIndex) s.index += 1;
      }
      node.index = targetIndex;
      reindex(parentId);

      listeners.moved.forEach((cb) =>
        cb(id, {
          parentId: node.parentId,
          index: node.index,
          oldParentId,
          oldIndex,
        }),
      );
    },

    async updateBookmark(id, changes) {
      const node = nodes.get(id);
      Object.assign(node, changes);
      listeners.changed.forEach((cb) => cb(id, { ...changes }));
    },

    async getBookmark(id) {
      const node = nodes.get(id);
      return node ? { ...node } : null;
    },

    async getChildren(parentId) {
      return childrenOf(parentId).map((n) => ({ ...n }));
    },

    async searchBookmarksByUrl(url) {
      return [...nodes.values()]
        .filter((n) => n.url === url)
        .map((n) => ({ ...n }));
    },

    onBookmarkCreated(cb) {
      listeners.created.push(cb);
    },
    onBookmarkRemoved(cb) {
      listeners.removed.push(cb);
    },
    onBookmarkChanged(cb) {
      listeners.changed.push(cb);
    },
    onBookmarkMoved(cb) {
      listeners.moved.push(cb);
    },
    onUrlVisited(cb) {
      listeners.visited.push(cb);
    },

    _emitVisited(url) {
      listeners.visited.forEach((cb) => cb({ url }));
    },

    async getState() {
      return state;
    },
    async setState(next) {
      state = next;
    },

    async getExpectedEvents() {
      return expectedEvents;
    },
    async setExpectedEvents(next) {
      expectedEvents = next;
    },

    async getPaused() {
      return paused;
    },
    async setPaused(next) {
      paused = next;
    },

    async showAlert() {
      // no-op in tests
    },
    async createContextMenu() {
      // no-op in tests
    },
    async updateContextMenu() {
      // no-op in tests
    },
    async refreshContextMenu() {
      // no-op in tests
    },
    onContextMenuShown() {
      // no-op in tests
    },
    onContextMenuClicked() {
      // no-op in tests
    },
    onMessage() {
      // no-op in tests
    },
    async sendMessage() {
      // no-op in tests
    },
    async clearStorage() {
      state = null;
      expectedEvents = [];
      paused = false;
    },
    async removeTree() {
      // no-op in tests
    },
  };
}