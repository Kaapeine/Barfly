import { TOOLBAR_ID, OTHER_ID } from "../platform/firefox-browser-api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reorderEntries(entries, movedDuplicateId) {
  const idx = entries.findIndex((e) => e.duplicateId === movedDuplicateId);
  if (idx <= 0) return entries;
  const [entry] = entries.splice(idx, 1);
  return [entry, ...entries];
}

async function addToDynamic(api, state, original) {
  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);

  const duplicate = await api.createBookmark({
    parentId: TOOLBAR_ID,
    index: separatorIndex + 1,
    title: original.title,
    url: original.url,
  });

  const newEntry = { originalId: original.id, duplicateId: duplicate.id };
  const entries = [newEntry, ...state.entries];

  // Prune if over capacity
  const dynChildren = await api.getChildren(TOOLBAR_ID);
  const dynamicDups = dynChildren.filter((c, i) => i > separatorIndex);
  if (dynamicDups.length > state.capacity) {
    const tail = dynamicDups[dynamicDups.length - 1];
    await api.removeBookmark(tail.id);
    const tailEntryIdx = entries.findIndex((e) => e.duplicateId === tail.id);
    if (tailEntryIdx !== -1) entries.splice(tailEntryIdx, 1);
  }

  return { ...state, entries };
}

// ---------------------------------------------------------------------------
// 4a: Rebuild state from toolbar
// ---------------------------------------------------------------------------

export async function rebuildFromToolbar(api, state) {
  const children = await api.getChildren(TOOLBAR_ID);
  let separatorIndex = children.findIndex((c) => c.id === state.separatorId);

  // Separator missing — recreate at index 0, prompt user to position it
  if (separatorIndex === -1) {
    try {
      await api.createNotification({
        type: "basic",
        title: "BarFly",
        message: "The bookmarks toolbar separator was missing and has been recreated. Drag it to your preferred position.",
      });
    } catch {
      // notifications not supported (e.g. tests)
    }
    const separator = await api.createBookmark({
      parentId: TOOLBAR_ID,
      index: 0,
      type: "separator",
    });
    state = { ...state, separatorId: separator.id };
    separatorIndex = 0;
  }

  const entries = [];
  const missingOrigins = [];

  for (let i = 0; i < children.length; i++) {
    if (i === separatorIndex) continue;
    const child = children[i];
    if (child.type !== "bookmark") continue;

    const matches = await api.searchBookmarksByUrl(child.url);
    const nonDuplicate = matches.find((m) => m.id !== child.id);
    if (nonDuplicate) {
      entries.push({ originalId: nonDuplicate.id, duplicateId: child.id });
    } else {
      missingOrigins.push(child.id);
    }
  }

  // Remove toolbar children whose original can't be found (orphans)
  for (const id of missingOrigins) {
    await api.removeBookmark(id);
  }

  return { entries, state };
}

// ---------------------------------------------------------------------------
// 4b: Handle visit — bump to front or add new
// ---------------------------------------------------------------------------

export async function handleVisit(api, state, url) {
  // Not a bookmarked URL — nothing to do
  const matches = await api.searchBookmarksByUrl(url);
  if (matches.length === 0) return state;

  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);
  const pinnedChildren = children.slice(0, separatorIndex);
  const dynamicChildren = children.slice(separatorIndex + 1);

  // If already pinned (before separator), user manages those — skip
  if (pinnedChildren.some((c) => c.url === url)) return state;

  // If already on the toolbar as a duplicate, bump to front of dynamic section
  const match = dynamicChildren.find((c) => c.url === url);
  if (match) {
    const entries = reorderEntries([...state.entries], match.id);
    await api.moveBookmark(match.id, { parentId: TOOLBAR_ID, index: separatorIndex + 1 });
    return { ...state, entries };
  }

  // Not yet tracked — add a duplicate
  const dupIds = new Set(state.entries.map((e) => e.duplicateId));
  const untracked = matches.find((m) => !dupIds.has(m.id));
  if (!untracked) return state;

  return addToDynamic(api, state, untracked);
}

// ---------------------------------------------------------------------------
// 4c: Handle bookmark created
// ---------------------------------------------------------------------------

export async function handleBookmarkCreated(api, state, id, node) {
  if (node.type !== "bookmark") return state;

  // Guard: if this is a duplicate we just created ourselves, skip
  if (state.entries.some((e) => e.duplicateId === id)) return state;

  if (node.parentId === TOOLBAR_ID) {
    // Created directly on toolbar — relocate to Other Bookmarks, add as duplicate
    await api.moveBookmark(id, { parentId: OTHER_ID });
    return addToDynamic(api, state, node);
  }

  return addToDynamic(api, state, node);
}

// ---------------------------------------------------------------------------
// 4d: Handle bookmark moved (promote / demote)
// ---------------------------------------------------------------------------

export async function handleBookmarkMoved(api, state, id, moveInfo) {
  const entry = state.entries.find((e) => e.duplicateId === id);

  // Tracked duplicate moved off the toolbar — clean up entry
  if (entry && moveInfo.parentId !== TOOLBAR_ID) {
    const entries = state.entries.filter((e) => e.duplicateId !== id);
    return { ...state, entries };
  }

  if (moveInfo.parentId !== TOOLBAR_ID) return state;

  if (!entry) {
    // Untracked item dragged onto toolbar — relocate back, then duplicate
    if (moveInfo.oldParentId && moveInfo.oldParentId !== TOOLBAR_ID) {
      await api.moveBookmark(id, { parentId: moveInfo.oldParentId, index: moveInfo.oldIndex });
      const bookmark = await api.getBookmark(id);
      return addToDynamic(api, state, bookmark);
    }
    return state;
  }

  // Tracked duplicate was moved on the toolbar — re-sort entries to match toolbar order
  const children = await api.getChildren(TOOLBAR_ID);
  const entries = [...state.entries].sort(
    (a, b) => children.findIndex((c) => c.id === a.duplicateId) -
             children.findIndex((c) => c.id === b.duplicateId)
  );
  return { ...state, entries };
}

// ---------------------------------------------------------------------------
// 4e: Handle bookmark changed (rename sync)
// ---------------------------------------------------------------------------

export async function handleBookmarkChanged(api, state, id, changeInfo) {
  const entry = state.entries.find((e) => e.originalId === id || e.duplicateId === id);
  if (!entry) return state;

  const counterpartId = entry.originalId === id ? entry.duplicateId : entry.originalId;
  await api.updateBookmark(counterpartId, changeInfo);
  return state;
}

// ---------------------------------------------------------------------------
// 4e continued: Handle bookmark removed (delete sync)
// ---------------------------------------------------------------------------

export async function handleBookmarkRemoved(api, state, id) {
  // Separator deleted — recreate it at index 0 and notify the user
  if (id === state.separatorId) {
    const separator = await api.createBookmark({
      parentId: TOOLBAR_ID,
      index: 0,
      type: "separator",
    });
    try {
      await api.createNotification({
        type: "basic",
        title: "BarFly",
        message: "The bookmarks toolbar separator was recreated. Drag it to your preferred position to split pinned and dynamic bookmarks.",
      });
    } catch {
      // notifications not supported (e.g. tests)
    }
    return { ...state, separatorId: separator.id };
  }

  const entryIdx = state.entries.findIndex((e) => e.originalId === id || e.duplicateId === id);
  if (entryIdx === -1) return state;

  const entry = state.entries[entryIdx];

  // If the original was deleted, remove its duplicate from the toolbar
  if (entry.originalId === id) {
    const dup = await api.getBookmark(entry.duplicateId);
    if (dup) {
      await api.removeBookmark(entry.duplicateId);
    }
  }
  // If the duplicate was deleted, leave the original untouched
  // (manual eviction by the user)

  const entries = [...state.entries];
  entries.splice(entryIdx, 1);
  return { ...state, entries };
}

// ---------------------------------------------------------------------------
// 5: Capacity change handling
// ---------------------------------------------------------------------------

export async function applyCapacityChange(api, state, newCapacity) {
  if (newCapacity >= state.capacity) {
    return { ...state, capacity: newCapacity };
  }

  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);
  const dynamicChildren = children.slice(separatorIndex + 1);

  let entries = [...state.entries];
  while (dynamicChildren.length > newCapacity) {
    const tail = dynamicChildren.pop();
    await api.removeBookmark(tail.id);
    const idx = entries.findIndex((e) => e.duplicateId === tail.id);
    if (idx !== -1) entries.splice(idx, 1);
  }

  return { ...state, capacity: newCapacity, entries };
}

// ---------------------------------------------------------------------------
// Context menu helpers
// ---------------------------------------------------------------------------

/**
 * Returns "Pin to bar" or "Unpin from bar" depending on the bookmark's
 * position relative to the separator.
 */
export async function getContextMenuTitle(api, state, bookmarkId) {
  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);
  const itemIndex = children.findIndex((c) => c.id === bookmarkId);
  if (itemIndex === -1) return "Pin to bar";
  return itemIndex < separatorIndex ? "Unpin from bar" : "Pin to bar";
}

/**
 * Moves a toolbar bookmark across the separator to toggle pinned/dynamic,
 * then rebuilds entries to match the new toolbar order.
 */
export async function handleContextMenuTogglePin(api, state, bookmarkId) {
  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);
  const itemIndex = children.findIndex((c) => c.id === bookmarkId);
  if (itemIndex === -1) return state;

  const isPinned = itemIndex < separatorIndex;
  if (isPinned) {
    await api.moveBookmark(bookmarkId, { parentId: TOOLBAR_ID, index: separatorIndex + 1 });
  } else {
    await api.moveBookmark(bookmarkId, { parentId: TOOLBAR_ID, index: 0 });
  }

  const result = await rebuildFromToolbar(api, state);
  return { ...result.state, entries: result.entries };
}
