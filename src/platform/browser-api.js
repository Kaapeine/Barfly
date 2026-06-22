import { createFirefoxAdapter } from "./firefox-adapter.js";
// import { createChromeAdapter } from "./chrome-adapter.js"; // future

/**
 * Detect runtime: Firefox exposes the global `browser` object,
 * Chrome exposes `chrome`. We check for Firefox first.
 */
const isFirefox =
  typeof browser !== "undefined" &&
  browser.runtime &&
  typeof browser.runtime.id === "string";

const adapter = isFirefox ? createFirefoxAdapter() : createFirefoxAdapter();
// When the Chrome adapter is written, change the fallback to:
// isFirefox ? createFirefoxAdapter() : createChromeAdapter();

export const {
  TOOLBAR_ID,
  OTHER_ID,
  createBookmark,
  removeBookmark,
  moveBookmark,
  updateBookmark,
  getBookmark,
  getChildren,
  searchBookmarksByUrl,
  getFullTree,
  onBookmarkCreated,
  onBookmarkRemoved,
  onBookmarkChanged,
  onBookmarkMoved,
  onUrlVisited,
  getState,
  setState,
  showAlert,
  createContextMenu,
  updateContextMenu,
  refreshContextMenu,
  onContextMenuShown,
  onContextMenuClicked,
  onMessage,
  sendMessage,
  clearStorage,
  removeTree,
  onInstalled,
  openTab,
  getSetupComplete,
  setSetupComplete,
  getExpectedEvents,
  setExpectedEvents,
  getPaused,
  setPaused,
} = adapter;
