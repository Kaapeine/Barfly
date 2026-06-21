/**
 * Firefox WebExtensions adapter.
 *
 * Uses the global `browser` object (Firefox's Promise-based API).
 */
export function createFirefoxAdapter() {
  return {
    TOOLBAR_ID: 'toolbar_____',
    OTHER_ID: 'unfiled_____',

    createBookmark({ parentId, index, title, url, type }) {
      return browser.bookmarks.create({ parentId, index, title, url, type });
    },

    removeBookmark(id) {
      return browser.bookmarks.remove(id);
    },

    moveBookmark(id, { parentId, index }) {
      return browser.bookmarks.move(id, { parentId, index });
    },

    updateBookmark(id, changes) {
      return browser.bookmarks.update(id, changes);
    },

    async getBookmark(id) {
      try {
        const nodes = await browser.bookmarks.get(id);
        return nodes[0] ?? null;
      } catch {
        return null;
      }
    },

    getChildren(parentId) {
      return browser.bookmarks.getChildren(parentId);
    },

    searchBookmarksByUrl(url) {
      return browser.bookmarks.search({ url });
    },

    getFullTree() {
      return browser.bookmarks.getTree();
    },

    onBookmarkCreated(callback) {
      browser.bookmarks.onCreated.addListener(callback);
    },

    onBookmarkRemoved(callback) {
      browser.bookmarks.onRemoved.addListener(callback);
    },

    onBookmarkChanged(callback) {
      browser.bookmarks.onChanged.addListener(callback);
    },

    onBookmarkMoved(callback) {
      browser.bookmarks.onMoved.addListener(callback);
    },

    onUrlVisited(callback) {
      browser.history.onVisited.addListener(callback);
    },

    async getState() {
      const stored = await browser.storage.local.get('state');
      return stored.state ?? null;
    },

    setState(state) {
      return browser.storage.local.set({ state });
    },

    async showAlert(message) {
      try {
        await browser.tabs.create({
          url: `src/options/release/options.html?alert=${encodeURIComponent(message)}`,
        });
      } catch {
        // ignore
      }
    },

    createContextMenu(options) {
      return browser.contextMenus.create(options);
    },

    updateContextMenu(id, options) {
      return browser.contextMenus.update(id, options);
    },

    refreshContextMenu() {
      return browser.contextMenus.refresh();
    },

    onContextMenuShown(callback) {
      browser.contextMenus.onShown.addListener(callback);
    },

    onContextMenuClicked(callback) {
      browser.contextMenus.onClicked.addListener(callback);
    },

    onMessage(callback) {
      browser.runtime.onMessage.addListener(callback);
    },

    sendMessage(message) {
      return browser.runtime.sendMessage(message);
    },

    clearStorage() {
      return browser.storage.local.clear();
    },

    removeTree(id) {
      return browser.bookmarks.removeTree(id);
    },

    onInstalled(callback) {
      browser.runtime.onInstalled.addListener(callback);
    },

    openTab(url) {
      return browser.tabs.create({ url });
    },

    async getSetupComplete() {
      const stored = await browser.storage.local.get('setupComplete');
      return stored.setupComplete ?? false;
    },

    setSetupComplete(value) {
      return browser.storage.local.set({ setupComplete: value });
    },
  };
}