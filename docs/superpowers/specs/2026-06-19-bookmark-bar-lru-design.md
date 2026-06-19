# Bookmark Bar LRU Manager — Design

## Overview

A browser extension (Firefox first, ported to Chrome later) that manages the
native Bookmarks Toolbar automatically. The toolbar shows two sections:

1. **Pinned** — a static, ordered mirror of a user-chosen "Pinned" folder.
2. **Dynamic** — a recency-ordered (LRU) list of recently-used bookmarks,
   capped at a configurable capacity. Items fall off the back of this list
   (oldest/least-recent) once capacity is exceeded.

The user keeps bookmarking and filing things into folders exactly as they do
today. The extension's job is purely to keep the toolbar populated with the
right pinned items plus whatever's "hot" right now, without the user manually
curating it.

## Goals

- Toolbar always reflects: pinned items (in folder order) + N most-recently-used
  bookmarks, automatically, with zero manual toolbar maintenance.
- Original bookmarks are never relocated or lost — eviction from the dynamic
  section never deletes user data, only a transient toolbar duplicate.
- Architecture is portable to Chrome's extension APIs with minimal rework.

## Non-goals

- No custom/injected toolbar UI — the extension manages the real, native
  Bookmarks Toolbar so existing browser interactions (drag, middle-click,
  context menu, folder dropdowns) keep working unmodified.
- No attempt to make "visible items" match toolbar width — that's native
  browser overflow behavior and is left alone.

## Architecture

### Browser API abstraction

All browser-specific calls are isolated behind a thin adapter module
(`src/platform/browser-api.js`) that exposes only the operations this
extension needs:

- `createBookmark`, `removeBookmark`, `moveBookmark`, `updateBookmark`
- `searchBookmarksByUrl`
- `onBookmarkCreated`, `onBookmarkRemoved`, `onBookmarkChanged`, `onBookmarkMoved`
- `onUrlVisited`
- `getState`, `setState` (backed by `storage.local`)

Core LRU/sync logic (`src/core/*`) only ever calls this adapter — never the
raw `browser.*` (Firefox) or `chrome.*` (Chrome) namespace directly. This
isolates two real Firefox/Chrome differences:

- Firefox's `browser.*` API is promise-based; Chrome's MV3 `chrome.*` API is
  callback-based (with partial promise support) — the adapter normalizes this.
- Chrome MV3 runs background logic in a service worker with no persistent
  in-memory state between events. Since all extension state already routes
  through `getState`/`setState` (backed by `storage.local`) rather than
  module-level variables, this is handled by construction.

Porting to Chrome later means writing a second adapter implementation and
swapping it in — the core logic does not change.

### Duplication model

Every bookmark shown on the toolbar (pinned or dynamic) is a **duplicate**:
a separate bookmark node (same URL/title) created by the extension. The
canonical/original bookmark always remains wherever the user filed it.

- Eviction = delete the toolbar duplicate. The original is untouched.
- No "return to origin folder" logic is needed, since the original never left.

### State

Tracked in `storage.local`:

```js
{
  pinnedFolderId: "<bookmarkId>",
  separatorId: "<bookmarkId>",   // native separator node dividing pinned | dynamic
  capacity: 10,                  // dynamic section size, user-configurable, no upper bound
  dynamicMap: {
    "<originalBookmarkId>": "<duplicateBookmarkId>"
  },
  pinnedMap: {
    "<originalBookmarkId>": "<duplicateBookmarkId>"
  }
}
```

Position in the toolbar (closer to the pinned section = more recent) **is**
the recency ranking for the dynamic section — no timestamps are stored.

A native `type: "separator"` bookmark node is created on the toolbar between
the pinned and dynamic sections (`createBookmark({ type: "separator",
parentId: toolbarId, index: pinnedCount })`). This gives a real visual
divider using the browser's own rendering, with no custom UI. Its id is
tracked in state so the extension can keep it positioned correctly as either
section's size changes.

### Sync rules

Matched via the `dynamicMap`/`pinnedMap` mappings, listening to
`onBookmarkChanged`/`onBookmarkRemoved`:

- **Rename** either copy (original or duplicate) → propagates to the other
  (two-way sync), including URL changes (so future visit-matching stays correct).
- **Delete the original** → its duplicate is automatically removed from the
  toolbar (no dangling entries).
- **Delete the duplicate** directly off the toolbar → treated as manual
  eviction. Original is untouched; entry removed from the relevant map.

## Core Flows

### Install / first run

1. Move existing contents of the real Bookmarks Toolbar into a new folder,
   "Bookmarks Toolbar archived on {date}" (under Other Bookmarks) — nothing is deleted.
2. Prompt via the options page for: a **Pinned folder** (any existing folder)
   and **capacity** (default 10, no enforced upper bound — e.g. 50 is fine).
3. Toolbar starts empty; pinned duplicates are created to mirror the Pinned
   folder; dynamic section fills up as the user browses/bookmarks.

### Visiting a bookmarked URL (`onUrlVisited`)

1. Match the visited URL against known bookmarks (`searchBookmarksByUrl`).
2. If it matches an entry in `pinnedMap` → no-op (already pinned).
3. If it matches an entry in `dynamicMap` → move its duplicate to the front
   of the dynamic section (recency touch).
4. If it matches an untracked bookmark → create a new duplicate at the front
   of the dynamic section, add to `dynamicMap`. If this exceeds `capacity`,
   evict the least-recent (tail) duplicate: delete it, remove its map entry.

Any URL visit not matching a bookmark at all is ignored — this is purely a
proxy for "a bookmarked page was used," accepting that typing/following a
link to a bookmarked URL also counts (no API distinguishes the two).

### Creating a new bookmark anywhere (`onBookmarkCreated`, parent ≠ toolbar)

Treated identically to a fresh visit-match in the dynamic section: a
duplicate is created at the front, evicting the LRU tail if over capacity.
This applies regardless of which folder the new bookmark was filed into.

### Pinned folder changes

`onBookmarkCreated`/`onBookmarkRemoved`/`onBookmarkMoved` events scoped to the
Pinned folder trigger a recompute of pinned duplicates to mirror the folder's
current contents and order. Two-way sync (above) keeps renames consistent.

### Capacity changed in settings

If decreased, immediately evict from the tail until the dynamic section fits
the new capacity. If increased, no immediate action (list just grows
naturally as new visits/bookmarks occur).

### Manual edits directly on the toolbar

The extension treats the toolbar as something it owns and continuously
reconciles, but explicitly supports these manual interactions:

- **New bookmark created directly under the toolbar** (e.g. via the bookmark
  star defaulting to the toolbar): detected as an untracked child appearing
  under the toolbar. The extension relocates it to **Other Bookmarks** (its
  permanent home) and creates a duplicate back on the toolbar's dynamic
  section, registering it in `dynamicMap`.
- **Dragging an existing bookmark from some folder onto the toolbar**: same
  detection (untracked item appears under the toolbar, this time via
  `onBookmarkMoved`). The extension moves it back to its `oldParentId` (the
  folder it came from) and creates a dynamic duplicate referencing it. In
  effect, **dragging something onto the bar means "promote this"** — the
  original is never relocated by a drag-to-promote action.
- **Deleting a toolbar item**: if it's a tracked duplicate, this is manual
  eviction (map entry removed, original untouched). Untracked items
  shouldn't normally exist on the toolbar given the rule above.
- **Reordering within the toolbar** (drag to reposition): allowed and
  respected. Since position is the recency model, dragging a dynamic
  duplicate closer to the front is equivalent to touching it.
- **Dragging across the pinned/dynamic separator**: see "Pinning and
  unpinning" below — this is the drag-to-pin / drag-to-unpin mechanism, not
  a self-correct.

## Pinning and unpinning

Two equivalent ways to move a bookmark between the dynamic and pinned
sections:

1. **Context menu**: the extension adds a "Pin to bar" / "Unpin from bar"
   item (via the `contextMenus` API) to the right-click menu on toolbar
   bookmarks, depending on which section the item is currently in.
2. **Drag across the separator**: dragging a dynamic duplicate past the
   separator into the pinned region, or a pinned duplicate past the
   separator into the dynamic region, triggers the same action as above —
   the drop position relative to `separatorId` is the trigger, not a
   distinct mechanism.

**Promote (dynamic → pinned):**
1. Create a new bookmark (copy of the dynamic entry's original — URL and
   title) inside the Pinned folder. This copy is a fully independent
   original from this point on — no ongoing link to whatever bookmark
   originally fed the dynamic entry.
2. Remove the dynamic duplicate from the toolbar and its `dynamicMap` entry.
3. The existing Pinned-folder-sync flow (see "Pinned folder changes")
   detects the new entry and creates its toolbar pinned duplicate
   automatically, recorded in `pinnedMap`.

**Demote (pinned → dynamic):**
1. Move the corresponding original out of the Pinned folder into **Other
   Bookmarks** (never deleted — same "never relocate into the void" rule as
   the toolbar-arrival case above) and remove its `pinnedMap` entry.
2. Remove its old pinned toolbar duplicate.
3. Create a new dynamic duplicate referencing the relocated original, at the
   drop position (or front, for the context-menu action), recorded in
   `dynamicMap`. If this exceeds `capacity`, evict the LRU tail as usual.

This means the Pinned folder is not just a mirror of pre-existing
bookmarks — it can contain originals created directly by a promote action,
exactly as it can contain originals the user files into it manually.

**Detecting a cross-separator drag:** `onBookmarkMoved` fires with
`{ parentId, index, oldParentId, oldIndex }` for the moved node. When
`parentId === toolbarId`:

1. Look up the moved bookmark's id in `dynamicMap`/`pinnedMap` (reverse
   lookup) to find which section it's currently tracked in, if any.
2. Fetch the toolbar's current children and find `separatorId`'s live index
   among them — read fresh at event time, not cached, since items shift
   around it constantly.
3. Compare the moved item's new `index` to the separator's index: before it
   = pinned region, after it = dynamic region.
4. If the resulting region differs from where the item is currently
   tracked, that's a cross-separator drag — trigger promote or demote. If
   unchanged, it's an in-section reorder (recency touch for dynamic items).

This same boundary check also covers the "untracked bookmark dragged onto
the toolbar from elsewhere" case (see above): which region it lands in
decides whether it gets promoted straight to pinned or to dynamic — one
shared piece of logic for both "new arrival" and "moved tracked item."

## Settings (options page)

- Pinned folder picker (any existing folder, selectable by path)
- Dynamic capacity (number input, no enforced upper bound)
- "Rebuild toolbar now" button — defensive manual recovery if state ever
  drifts from the toolbar's actual contents

## Edge Cases

- **Original deleted while its duplicate is on the bar** → duplicate removed
  automatically (sync rule).
- **Original's URL changed** (not just title) → duplicate's URL updates too,
  so future visit-matching still works.
- **Same URL bookmarked in multiple places** → `searchBookmarksByUrl` may
  return multiple matches; only the first untracked match is acted on, to
  avoid creating duplicate dynamic entries for the same URL.
- **Extension disabled/uninstalled** → toolbar duplicates are left in place
  as ordinary orphaned bookmarks (Firefox does not auto-revert them to "Old
  Bookmarks Toolbar"). Recoverable manually; consistent with how most
  extensions behave on removal.
- **Pinned folder deleted** → extension treats Pinned as empty rather than
  crashing, and the options page should surface that the configured pinned
  folder is missing.

## Testing Strategy

- **Unit tests** for the core LRU/eviction/sync logic as pure functions
  (`state + event -> new state + side effects`), independent of any browser
  API, using the abstraction boundary described above.
- **Manual/integration testing** in real Firefox (`web-ext run`) for the
  API-glue layer — listeners, bookmark mutations, toolbar rewrites — since
  the `bookmarks`/`history` APIs aren't easily mocked.
