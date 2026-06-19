import { TOOLBAR_ID } from "../platform/firefox-browser-api.js";
import { touchDynamic, addDynamic } from "../core/lru.js";

/**
 * Reads the current LRU order of the dynamic section from the toolbar.
 * Returns original bookmark ids (not duplicate ids), most-recent first.
 *
 * @returns {Promise<string[]>} Ordered original ids for tracked dynamic items.
 */
export async function getDynamicOriginalIdOrderFromToolbar(api, state) {
  // All bookmark nodes currently on the toolbar, in browser order.
  const toolbarChildren = await api.getChildren(TOOLBAR_ID);
  // Index of the pinned|dynamic divider; everything before it is pinned.
  const separatorIndex = toolbarChildren.findIndex((c) => c.id === state.separatorId);
  // Dynamic section only — toolbar duplicate nodes after the separator.
  const dynamicToolbarNodes = toolbarChildren.slice(separatorIndex + 1);
  // dynamicMap is originalId → duplicateId; invert to resolve toolbar node ids.
  const duplicateIdToOriginalId = new Map(
    Object.entries(state.dynamicMap).map(([originalId, duplicateId]) => [duplicateId, originalId]),
  );
  // Map each toolbar node to its original id; drop untracked toolbar children
  // (e.g. a bookmark the user dragged onto the bar before manual-edits runs).
  return dynamicToolbarNodes
    .map((node) => duplicateIdToOriginalId.get(node.id))
    .filter(Boolean);
}

/**
 * Reorders dynamic toolbar duplicates to match the given LRU order.
 * `originalIdsInOrder` lists original ids; `dynamicMap` resolves each to its duplicate node.
 *
 * @returns {Promise<void>}
 */
export async function reorderDynamicDuplicatesOnToolbar(api, state, originalIdsInOrder, dynamicMap) {
  const toolbarChildren = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = toolbarChildren.findIndex((c) => c.id === state.separatorId);
  for (let i = 0; i < originalIdsInOrder.length; i++) {
    const originalId = originalIdsInOrder[i];
    const duplicateId = dynamicMap[originalId];
    await api.moveBookmark(duplicateId, { parentId: TOOLBAR_ID, index: separatorIndex + 1 + i });
  }
}

/**
 * Adds a bookmark that is not yet tracked in the dynamic section: creates a toolbar
 * duplicate, registers it in dynamicMap, evicts LRU tail items over capacity, and
 * reorders the toolbar to match.
 *
 * @returns {Promise<object>} Updated state with a new dynamicMap entry (and evictions applied).
 */
export async function addUntrackedOriginalToDynamic(api, state, originalId) {
  const originalBookmark = await api.getBookmark(originalId);
  const currentOriginalIdOrder = await getDynamicOriginalIdOrderFromToolbar(api, state);

  const newDuplicateId = (
    await api.createBookmark({
      parentId: TOOLBAR_ID,
      title: originalBookmark.title,
      url: originalBookmark.url,
    })
  ).id;
  const dynamicMap = { ...state.dynamicMap, [originalId]: newDuplicateId };
  const { order: originalIdsInLruOrder, evicted: evictedOriginalIds } = addDynamic(
    currentOriginalIdOrder,
    originalId,
    state.capacity,
  );

  for (const evictedOriginalId of evictedOriginalIds) {
    const evictedDuplicateId = dynamicMap[evictedOriginalId];
    await api.removeBookmark(evictedDuplicateId);
    delete dynamicMap[evictedOriginalId];
  }

  const nextState = { ...state, dynamicMap };
  await reorderDynamicDuplicatesOnToolbar(api, nextState, originalIdsInLruOrder, dynamicMap);
  return nextState;
}

/**
 * Handles a visited URL: if it matches an untracked original bookmark, adds it to
 * the dynamic section; if already dynamic, bumps it to the front; if pinned or
 * unmatched, does nothing.
 *
 * @returns {Promise<object>} Unchanged state, or state with an updated dynamicMap after add.
 */
export async function handleVisit(api, state, url) {
  const urlMatches = await api.searchBookmarksByUrl(url);
  const toolbarDuplicateIds = new Set([
    ...Object.values(state.dynamicMap),
    ...Object.values(state.pinnedMap),
  ]);
  const matchedOriginal = urlMatches.find((bookmark) => !toolbarDuplicateIds.has(bookmark.id));
  if (!matchedOriginal) return state;

  const matchedOriginalId = matchedOriginal.id;
  if (state.pinnedMap[matchedOriginalId]) return state;

  if (state.dynamicMap[matchedOriginalId]) {
    const currentOriginalIdOrder = await getDynamicOriginalIdOrderFromToolbar(api, state);
    const bumpedOriginalIdOrder = touchDynamic(currentOriginalIdOrder, matchedOriginalId);
    await reorderDynamicDuplicatesOnToolbar(api, state, bumpedOriginalIdOrder, state.dynamicMap);
    return state;
  }

  return addUntrackedOriginalToDynamic(api, state, matchedOriginalId);
}
