export const TOOLBAR_ID = "toolbar_____";
export const OTHER_ID = "unfiled_____";

export function createBookmark({ parentId, index, title, url, type }) {
  return browser.bookmarks.create({ parentId, index, title, url, type });
}

export function removeBookmark(id) {
  return browser.bookmarks.remove(id);
}

export function moveBookmark(id, { parentId, index }) {
  return browser.bookmarks.move(id, { parentId, index });
}

export function updateBookmark(id, changes) {
  return browser.bookmarks.update(id, changes);
}

export async function getBookmark(id) {
  try {
    const nodes = await browser.bookmarks.get(id);
    return nodes[0] ?? null;
  } catch {
    return null;
  }
}

export function getChildren(parentId) {
  return browser.bookmarks.getChildren(parentId);
}

export function searchBookmarksByUrl(url) {
  return browser.bookmarks.search({ url });
}

export function getFullTree() {
  return browser.bookmarks.getTree();
}

export function onBookmarkCreated(callback) {
  browser.bookmarks.onCreated.addListener(callback);
}

export function onBookmarkRemoved(callback) {
  browser.bookmarks.onRemoved.addListener(callback);
}

export function onBookmarkChanged(callback) {
  browser.bookmarks.onChanged.addListener(callback);
}

export function onBookmarkMoved(callback) {
  browser.bookmarks.onMoved.addListener(callback);
}

export function onUrlVisited(callback) {
  browser.history.onVisited.addListener(callback);
}

export async function getState() {
  const stored = await browser.storage.local.get("state");
  return stored.state ?? null;
}

export function setState(state) {
  return browser.storage.local.set({ state });
}
