import { TOOLBAR_ID, OTHER_ID } from "../platform/browser-api.js";

const SAVED_TO_TOOLBAR_TITLE = 'Saved to Bookmarks Toolbar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOrCreateSavedToolbarFolder(api) {
  const children = await api.getChildren(OTHER_ID);
  const existing = children.find(
    (c) => c.type === 'folder' && c.title === SAVED_TO_TOOLBAR_TITLE,
  );
  if (existing) return existing.id;
  const folder = await api.createBookmark({
    parentId: OTHER_ID,
    title: SAVED_TO_TOOLBAR_TITLE,
    type: 'folder',
  });
  return folder.id;
}

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

  // Prune if over capacity. Only ever evict a *tracked* duplicate — never a
  // bookmark that merely happens to sit in the dynamic region. During a
  // multi-item drag the browser drops every dragged bookmark onto the toolbar
  // before firing the per-item events; siblings not yet processed sit there
  // bare and untracked, and removeBookmark would delete them permanently.
  const dynChildren = await api.getChildren(TOOLBAR_ID);
  const dupIds = new Set(entries.map((e) => e.duplicateId));
  const trackedDups = dynChildren.filter((c, i) => i > separatorIndex && dupIds.has(c.id));
  if (trackedDups.length > state.capacity) {
    const tail = trackedDups[trackedDups.length - 1];
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
      api.showAlert(
        'The bookmarks toolbar separator was missing and has been recreated. Drag it to your preferred position.',
      );
    } catch {
      // alerts not supported (e.g. tests)
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

  for (let i = 0; i < children.length; i++) {
    if (i === separatorIndex) continue;
    const child = children[i];
    if (child.type !== "bookmark") continue;

    const matches = await api.searchBookmarksByUrl(child.url);
    const nonDuplicate = matches.find((m) => m.id !== child.id);
    if (nonDuplicate) {
      entries.push({ originalId: nonDuplicate.id, duplicateId: child.id });
    } else {
      // Orphan: a toolbar bookmark with no original anywhere. This is
      // ambiguous — the user may have added it directly while BarFly was
      // disabled, or deleted its original. Deleting would be irreversible
      // data loss, so adopt it instead: leave the toolbar node exactly where
      // it sits (preserving pinned/dynamic position) and create a backing
      // original in the dedicated folder, tracking the toolbar node as its
      // duplicate. `api` must be the tracking wrapper so this create's echo
      // is suppressed rather than spawning a second duplicate.
      const folderId = await getOrCreateSavedToolbarFolder(api);
      const original = await api.createBookmark({
        parentId: folderId,
        title: child.title,
        url: child.url,
      });
      entries.push({ originalId: original.id, duplicateId: child.id });
    }
  }

  return { entries, state };
}

// ---------------------------------------------------------------------------
// 4b: Handle visit — bump to front or add new
// ---------------------------------------------------------------------------

export async function handleVisit(api, state, url) {
  // Not a bookmarked URL — nothing to do. `matches` are the bookmarks the
  // browser itself considers a match (it normalizes e.g. trailing slashes).
  const matches = await api.searchBookmarksByUrl(url);
  if (matches.length === 0) return state;
  const matchIds = new Set(matches.map((m) => m.id));

  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);
  const pinnedChildren = children.slice(0, separatorIndex);
  const dynamicChildren = children.slice(separatorIndex + 1);

  // If already pinned (before separator), the user manages those — skip.
  if (pinnedChildren.some((c) => matchIds.has(c.id))) return state;

  // If already on the toolbar as a duplicate, bump to front of dynamic section.
  const match = dynamicChildren.find((c) => matchIds.has(c.id));
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
    // Created directly on toolbar — relocate to a dedicated folder, add as duplicate
    const folderId = await getOrCreateSavedToolbarFolder(api);
    await api.moveBookmark(id, { parentId: folderId });
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
      const bookmark = await api.getBookmark(id);
      // Only bookmarks get duplicated. A folder or separator dragged onto the
      // toolbar isn't a duplicate of anything — leave it where the user
      // dropped it (duplicating it would create a junk url-less node).
      if (!bookmark || bookmark.type !== 'bookmark') return state;
      await api.moveBookmark(id, { parentId: moveInfo.oldParentId, index: moveInfo.oldIndex });
      // The dragged bookmark may itself be the *original* of an existing
      // entry (its duplicate already sitting elsewhere on the toolbar,
      // pinned or dynamic). It's already represented — don't double it up.
      if (state.entries.some((e) => e.originalId === id)) return state;
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

export async function handleBookmarkRemoved(api, state, id, removeInfo) {
  // Separator deleted — recreate it at index 0 and notify the user
  if (id === state.separatorId) {
    const separator = await api.createBookmark({
      parentId: TOOLBAR_ID,
      index: 0,
      type: "separator",
    });
    try {
      api.showAlert(
        'The bookmarks toolbar separator was recreated. Drag it to your preferred position to split pinned and dynamic bookmarks.',
      );
    } catch {
      // alert not supported (e.g. tests)
    }
    return { ...state, separatorId: separator.id };
  }

  let entries = [...state.entries];

  const directIdx = entries.findIndex(
    (e) => e.originalId === id || e.duplicateId === id,
  );
  if (directIdx !== -1) {
    const entry = entries[directIdx];
    // If the original was deleted, remove its duplicate from the toolbar.
    // If the duplicate was deleted, leave the original untouched (manual
    // eviction by the user).
    if (entry.originalId === id) {
      const dup = await api.getBookmark(entry.duplicateId);
      if (dup) {
        await api.removeBookmark(entry.duplicateId);
      }
    }
    entries.splice(directIdx, 1);
  }

  // A single bookmark deletion can't hide any other tracked original, so
  // only a *folder* removal needs the sweep below. removeInfo.node gives us
  // the removed node's own type for free — use it to skip the sweep (and its
  // O(n) getBookmark calls) on every plain bookmark deletion, which is the
  // overwhelmingly common case. If type is missing for any reason, sweep
  // anyway rather than risk leaving an orphan.
  const removedType = removeInfo?.node?.type;
  if (removedType === "bookmark" || removedType === "separator") {
    return { ...state, entries };
  }

  // Firefox fires a single onRemoved for the top of a removed subtree, and
  // removeInfo.node does NOT include the subtree's children — so we can't
  // enumerate what got deleted from the event itself. Check liveness
  // directly instead: any tracked original that no longer exists — because
  // it (or an ancestor folder) was just removed — gets its duplicate
  // cleaned up.
  const survivors = [];
  for (const entry of entries) {
    const original = await api.getBookmark(entry.originalId);
    if (!original) {
      const dup = await api.getBookmark(entry.duplicateId);
      if (dup) {
        await api.removeBookmark(entry.duplicateId);
      }
      continue;
    }
    survivors.push(entry);
  }

  return { ...state, entries: survivors };
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
