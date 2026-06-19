# Bookmark Bar LRU Manager — Simplified Implementation Plan

> **For agentic workers:** implement this plan task-by-task. Stop after every task and explain the changes made to the user. Explain what can be verified and how to do it. Let the user check before asking to commit. Never commit without this step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Firefox WebExtension that manages the native Bookmarks Toolbar as two sections divided by a separator: **pinned** (before separator, user-managed) and **dynamic** (after separator, LRU-capped, extension-managed).

**Key simplification over the original plan:** No separate pinned folder, no `pinnedMap`/`dynamicMap`, no folder mirroring/sync, no order derivation. The toolbar IS the source of truth. Pinned vs dynamic is determined purely by position relative to the separator. A single `entries` array tracks `{ originalId, duplicateId }` pairs for rename/delete sync only. Promote/demote is just moving a toolbar item across the separator.

**Tech Stack:** Vanilla JavaScript (ES modules), Firefox WebExtensions APIs (`bookmarks`, `history`, `storage`, `contextMenus`), Vitest for unit tests, `web-ext` for manual/integration testing.

---

## Architecture

### State (stored in `storage.local`)

```js
{
  separatorId: "...",      // the native separator bookmark node
  capacity: 10,            // max dynamic items
  entries: [
    // Before separator = pinned (extension never evicts)
    // After separator  = dynamic (extension manages: add, bump, evict)
    { originalId: "a", duplicateId: "dup-a" },
    { originalId: "b", duplicateId: "dup-b" },
    // ...separator lives here at some index...
    { originalId: "c", duplicateId: "dup-c" },
  ]
}
```

Section is determined at runtime by comparing each entry's toolbar position to the separator's index — no separate tracking needed. The `entries` array order matches toolbar order so rebuild-from-toolbar is trivial.

### Flows

| Flow | What happens |
|------|-------------|
| **Install** | Archive existing toolbar contents → create separator at index 0 → save default state |
| **New bookmark anywhere** (parent ≠ toolbar) | Create duplicate at front of dynamic section, prune tail if over capacity, add entry |
| **New bookmark directly on toolbar** (parent = toolbar) | Move original to Other Bookmarks → create duplicate at front of dynamic section, prune tail, add entry |
| **Drag from folder onto toolbar** | Move original back to its folder → create duplicate at drop position (pinned or dynamic), add entry if dynamic |
| **Visit → bump** | Match toolbar child by URL → move to front of dynamic section → reorder `entries` to match |
| **Promote** (dynamic → pinned) | Move the toolbar duplicate before the separator → array reordering reflects the change |
| **Demote** (pinned → dynamic) | Move the toolbar duplicate after the separator → array reordering reflects the change |
| **Rename** (onBookmarkChanged) | Search `entries` by `originalId` or `duplicateId` → find counterpart → `updateBookmark` on it |
| **Delete original** (onBookmarkRemoved) | Search `entries` by `originalId` → remove counterpart from toolbar + entries |
| **Delete duplicate** (onBookmarkRemoved) | Search `entries` by `duplicateId` → remove entry (original untouched) |
| **Capacity shrink** | Prune dynamic tail → remove from toolbar + entries |
| **Separator deleted** | Recreate at index 0, prompt user to reposition |
| **Context menu toggle** | If before separator → demote. If after → promote. |

---

## File Structure

```
manifest.json         ✅ already exists
package.json          ✅ already exists
vitest.config.js      ✅ already exists
src/
  platform/
    firefox-browser-api.js    ✅ already exists
  background/
    install.js                🔄 update (remove createDefaultState dependency)
    events.js                 ✨ new file
    background.js             ✨ new file
  options/
    options.html              ✨ new file
    options.js                ✨ new file
tests/
  platform/
    fake-browser-api.js       ✅ already exists
    fake-browser-api.test.js  ✅ already exists
  background/
    install.test.js           🔄 update (assert new state shape)
    events.test.js            ✨ new file

### Files to delete (from previous plan)
```
src/core/state.js            src/core/lru.js            src/core/pinned.js
src/core/region.js           src/background/pinned-sync.js
src/background/visits.js     src/background/pin-actions.js
src/background/manual-edits.js
tests/core/state.test.js     tests/core/lru.test.js
tests/core/pinned.test.js    tests/core/region.test.js
tests/background/pinned-sync.test.js   tests/background/visits.test.js
tests/background/pin-actions.test.js   tests/background/manual-edits.test.js
```

---

## Task 0: Clean up previous plan files

The original plan created files for an overcomplicated architecture. Delete them and update the two files that need adapting.

**Files:**
- Delete: 16 files (listed in the structure above)
- Update: `src/background/install.js` (stop importing `createDefaultState`)
- Update: `tests/background/install.test.js` (assert new state shape)

- [ ] **Step 1: Delete obsolete files**

Run:
```bash
cd /Users/vathsa/Documents/Projects/bookmarkbar
rm src/core/state.js src/core/lru.js src/core/pinned.js src/core/region.js
rm src/background/pinned-sync.js src/background/visits.js src/background/pin-actions.js src/background/manual-edits.js
rm tests/core/state.test.js tests/core/lru.test.js tests/core/pinned.test.js tests/core/region.test.js
rm tests/background/pinned-sync.test.js tests/background/visits.test.js tests/background/pin-actions.test.js tests/background/manual-edits.test.js
```

- [ ] **Step 2: Verify deletions**

Run: `ls src/core/ src/background/ tests/core/ tests/background/`
Expected: Only the files listed in the target file structure remain.

- [ ] **Step 3: Update `src/background/install.js`**

Replace `import { createDefaultState } from "../core/state.js"` with inline state:

```js
import { TOOLBAR_ID, OTHER_ID } from "../platform/firefox-browser-api.js";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export async function runInstall(api, now = new Date()) {
  const existing = await api.getState();
  if (existing) return existing;

  const toolbarChildren = await api.getChildren(TOOLBAR_ID);

  if (toolbarChildren.length > 0) {
    const archiveFolder = await api.createBookmark({
      parentId: OTHER_ID,
      title: `Bookmarks Toolbar archived on ${formatDate(now)}`,
      type: "folder",
    });
    for (const child of toolbarChildren) {
      await api.moveBookmark(child.id, { parentId: archiveFolder.id });
    }
  }

  const separator = await api.createBookmark({
    parentId: TOOLBAR_ID,
    index: 0,
    type: "separator",
  });

  const state = { separatorId: separator.id, capacity: 10, entries: [] };
  await api.setState(state);
  return state;
}
```

- [ ] **Step 4: Update `tests/background/install.test.js`**

Replace old state-shape assertions with new simplified ones:

```js
import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID, OTHER_ID } from "../../src/platform/firefox-browser-api.js";
import { runInstall } from "../../src/background/install.js";

describe("runInstall", () => {
  it("creates a separator and default state when the toolbar is empty", async () => {
    const api = createFakeBrowserApi();
    const now = new Date("2026-06-20T00:00:00Z");

    const state = await runInstall(api, now);

    expect(state.separatorId).toBeDefined();
    expect(state.capacity).toBe(10);
    expect(state.entries).toEqual([]);

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren).toEqual([
      expect.objectContaining({ id: state.separatorId, type: "separator" }),
    ]);
  });

  it("archives existing toolbar contents under Other Bookmarks", async () => {
    const api = createFakeBrowserApi();
    const first = await api.createBookmark({ parentId: TOOLBAR_ID, title: "First", url: "https://first.test" });
    const second = await api.createBookmark({ parentId: TOOLBAR_ID, title: "Second", url: "https://second.test" });
    const now = new Date("2026-06-20T00:00:00Z");

    await runInstall(api, now);

    const otherChildren = await api.getChildren(OTHER_ID);
    expect(otherChildren).toHaveLength(1);
    const archiveFolder = otherChildren[0];
    expect(archiveFolder.title).toBe("Bookmarks Toolbar archived on 2026-06-20");
    expect(archiveFolder.type).toBe("folder");

    const archived = await api.getChildren(archiveFolder.id);
    expect(archived.map((n) => n.id)).toEqual([first.id, second.id]);

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren).toHaveLength(1);
    expect(toolbarChildren[0].type).toBe("separator");
  });

  it("is idempotent: does nothing if state already exists", async () => {
    const api = createFakeBrowserApi();
    const now = new Date("2026-06-20T00:00:00Z");
    const first = await runInstall(api, now);

    const second = await runInstall(api, now);

    expect(second).toEqual(first);
    expect(await api.getChildren(OTHER_ID)).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the install test to verify it passes**

Run: `npm test -- tests/background/install.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Verify the full test suite only has remaining tests**

Run: `npm test`
Expected: Vitest reports only the platform and install tests running (2 test files), no failures.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete plan files, update install to simplified state shape"
```

**Files:**
- Create: package.json
- Create: manifest.json
- Create: vitest.config.js

- [ ] **Step 1: Create package.json**

```json
{
  "name": "bookmark-bar-lru",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "web-ext run"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "web-ext": "^7.11.0"
  }
}
```

- [ ] **Step 2: Create vitest.config.js**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
  },
});
```

- [ ] **Step 3: Create manifest.json**

```json
{
  "manifest_version": 2,
  "name": "Bookmark Bar LRU Manager",
  "version": "0.1.0",
  "description": "Keeps the bookmarks toolbar limited to pinned items plus a recency-capped dynamic list.",
  "permissions": [
    "bookmarks",
    "history",
    "storage",
    "contextMenus"
  ],
  "background": {
    "scripts": ["src/background.js"],
    "type": "module"
  },
  "options_ui": {
    "page": "src/options/options.html",
    "open_in_tab": true
  }
}
```

- [ ] **Step 4: Install dependencies**

Run: `cd /Users/vathsa/Documents/Projects/bookmarkbar && npm install`
Expected: node_modules created, no errors.

- [ ] **Step 5: Verify the test runner works with zero tests**

Run: `npm test`
Expected: Vitest reports "No test files found". If it errors instead, fix vitest.config.js before continuing.

- [ ] **Step 6: Initialize git and commit**

```bash
cd /Users/vathsa/Documents/Projects/bookmarkbar
git init
git add package.json manifest.json vitest.config.js docs/
git commit -m "chore: scaffold bookmark bar LRU extension project"
```

---

## Task 2: Fake browser API for testing

An in-memory implementation of the adapter interface used by all background tests. Already exists in the workspace — verify it works.

**Files:**
- Verify: fake-browser-api.js exists
- Verify: fake-browser-api.test.js exists

- [ ] **Step 1: Run existing fake test**

Run: `npm test -- tests/platform/fake-browser-api.test.js`
Expected: PASS (5 tests). If not, fix the fake before proceeding.

- [ ] **Step 2: Add missing `getChildren` support for folder-type nodes**

The fake currently only handles `"bookmark"` type nodes. We need to support `"separator"` type for the separator, and `"folder"` type for the archive folder during install.

Check if the existing fake already handles these — look at fake-browser-api.js to see the current `createBookmark` implementation.

- [ ] **Step 3: Commit any fixes**

```bash
git add tests/platform/fake-browser-api.js tests/platform/fake-browser-api.test.js
git commit -m "test: fix fake browser API to handle separator/folder types"
```

---

## Task 3: Install flow

First-run: archive any existing toolbar contents into Other Bookmarks, create the separator at index 0, persist initial state.

**Files:**
- Create: install.js
- Test: install.test.js

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID, OTHER_ID } from "../../src/platform/firefox-browser-api.js";
import { runInstall } from "../../src/background/install.js";

describe("runInstall", () => {
  it("creates a separator and default state when the toolbar is empty", async () => {
    const api = createFakeBrowserApi();
    const now = new Date("2026-06-20T00:00:00Z");

    const state = await runInstall(api, now);

    expect(state.separatorId).toBeDefined();
    expect(state.capacity).toBe(10);
    expect(state.entries).toEqual([]);

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren).toEqual([
      expect.objectContaining({ id: state.separatorId, type: "separator" }),
    ]);
  });

  it("archives existing toolbar contents under Other Bookmarks", async () => {
    const api = createFakeBrowserApi();
    const first = await api.createBookmark({ parentId: TOOLBAR_ID, title: "First", url: "https://first.test" });
    const second = await api.createBookmark({ parentId: TOOLBAR_ID, title: "Second", url: "https://second.test" });
    const now = new Date("2026-06-20T00:00:00Z");

    await runInstall(api, now);

    const otherChildren = await api.getChildren(OTHER_ID);
    expect(otherChildren).toHaveLength(1);
    const archiveFolder = otherChildren[0];
    expect(archiveFolder.title).toBe("Bookmarks Toolbar archived on 2026-06-20");
    expect(archiveFolder.type).toBe("folder");

    const archived = await api.getChildren(archiveFolder.id);
    expect(archived.map((n) => n.id)).toEqual([first.id, second.id]);

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren).toHaveLength(1);
    expect(toolbarChildren[0].type).toBe("separator");
  });

  it("is idempotent: does nothing if state already exists", async () => {
    const api = createFakeBrowserApi();
    const now = new Date("2026-06-20T00:00:00Z");
    const first = await runInstall(api, now);

    const second = await runInstall(api, now);

    expect(second).toEqual(first);
    expect(await api.getChildren(OTHER_ID)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/background/install.test.js`
Expected: FAIL — `Cannot find module install.js'`

- [ ] **Step 3: Write minimal implementation**

```js
import { TOOLBAR_ID, OTHER_ID } from "../platform/browser-api.js";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export async function runInstall(api, now = new Date()) {
  const existing = await api.getState();
  if (existing) return existing;

  const toolbarChildren = await api.getChildren(TOOLBAR_ID);

  if (toolbarChildren.length > 0) {
    const archiveFolder = await api.createBookmark({
      parentId: OTHER_ID,
      title: `Bookmarks Toolbar archived on ${formatDate(now)}`,
      type: "folder",
    });
    for (const child of toolbarChildren) {
      await api.moveBookmark(child.id, { parentId: archiveFolder.id });
    }
  }

  const separator = await api.createBookmark({
    parentId: TOOLBAR_ID,
    index: 0,
    type: "separator",
  });

  const state = { separatorId: separator.id, capacity: 10, entries: [] };
  await api.setState(state);
  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/background/install.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/background/install.js tests/background/install.test.js
git commit -m "feat: add install/first-run flow"
```

---

## Task 4: Events — all core flow logic

The single module that handles every flow: add, bump, promote, demote, rename sync, delete sync, and capacity changes. Tested against the fake adapter.

**Files:**
- Create: `src/background/events.js`
- Test: `tests/background/events.test.js`

### Sub-task 4a: Rebuild state from toolbar

A helper that reads the live toolbar and rebuilds the `entries` array to match. Used at startup and as a recovery mechanism.

- [ ] **Step 1: Write test for state rebuild**

```js
import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID } from "../../src/platform/firefox-browser-api.js";
import { rebuildFromToolbar } from "../../src/background/events.js";
import { runInstall } from "../../src/background/install.js";

describe("rebuildFromToolbar", () => {
  it("rebuilds entries from toolbar children", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const state = await runInstall(api);
    // separator is at index 0
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });

    const entries = await rebuildFromToolbar(api, state);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ originalId: orig.id, duplicateId: dup.id });
  });

  it("returns empty array if toolbar only has the separator", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);

    const entries = await rebuildFromToolbar(api, state);

    expect(entries).toEqual([]);
  });

  it("skips the separator itself", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    // separator is at index 0
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "folder", title: "B", url: "https://b.test" });
    const dupA = await api.createBookmark({ parentId: TOOLBAR_ID, index: 0, title: "A", url: "https://a.test" });
    const dupB = await api.createBookmark({ parentId: TOOLBAR_ID, index: 2, title: "B", url: "https://b.test" });

    const entries = await rebuildFromToolbar(api, state);

    expect(entries.map((e) => e.duplicateId)).toEqual([dupA.id, dupB.id]);
  });
});
```

- [ ] **Step 2: Write implementation**

```js
import { TOOLBAR_ID } from "../platform/browser-api.js";

export async function rebuildFromToolbar(api, state) {
  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);
  if (separatorIndex === -1) return [];

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

  return entries;
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- tests/background/events.test.js -- --testNamePattern=rebuildFromToolbar`
Expected: PASS (3 tests)

### Sub-task 4b: Handle visit — bump to front or add new

- [ ] **Step 1: Write test**

```js
describe("handleVisit", () => {
  it("moves an existing dynamic duplicate to the front on revisit", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dupA = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });
    const dupB = await api.createBookmark({ parentId: TOOLBAR_ID, title: "B", url: "https://b.test", index: 2 });
    const entries = [
      { originalId: orig.id, duplicateId: dupA.id },
      { originalId: "b-orig", duplicateId: dupB.id },
    ];
    const current = { ...state, entries };

    const next = await handleVisit(api, current, "https://a.test");

    const toolbar = await api.getChildren(TOOLBAR_ID);
    const dynChildren = toolbar.slice(1); // after separator at index 0
    expect(dynChildren[0].url).toBe("https://a.test");
  });

  it("does nothing when the URL matches no bookmark", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const next = await handleVisit(api, state, "https://nowhere.test");
    expect(next).toEqual(state);
  });

  it("does nothing for a pinned item (before separator)", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    // pinned = before separator
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, index: 0, title: "A", url: "https://a.test" });
    // move separator to index 1
    await api.moveBookmark(state.separatorId, { parentId: TOOLBAR_ID, index: 1 });
    const entries = [{ originalId: orig.id, duplicateId: dup.id }];
    const current = { ...state, entries };
    // separator is now at index 1, dup is at index 0 = pinned

    const next = await handleVisit(api, current, "https://a.test");

    expect(next).toEqual(current);
  });

  it("creates a duplicate for a visited untracked bookmark", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });

    const next = await handleVisit(api, state, "https://a.test");

    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].originalId).toBe(orig.id);
    const toolbar = await api.getChildren(TOOLBAR_ID);
    expect(toolbar).toHaveLength(2); // separator + dup
  });

  it("evicts from the tail when capacity is exceeded", async () => {
    const api = createFakeBrowserApi();
    const state = { ...(await runInstall(api)), capacity: 1 };
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "folder", title: "B", url: "https://b.test" });

    const nextA = await handleVisit(api, state, "https://a.test");
    const nextB = await handleVisit(api, nextA, "https://b.test");

    expect(nextB.entries).toHaveLength(1);
    expect(Object.values(nextB.entries).map((e) => e.originalId)).toEqual([b.id]);
  });
});
```

- [ ] **Step 2: Write implementation**

```js
export async function handleVisit(api, state, url) {
  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);

  // Find which toolbar children match this URL
  const dynamicChildren = children.slice(separatorIndex + 1);
  const match = dynamicChildren.find((c) => c.url === url);
  if (!match) {
    // Not on toolbar — check if it's a bookmarked URL we should add
    const matches = await api.searchBookmarksByUrl(url);
    if (matches.length === 0) return state;

    // Don't add if already pinned (before separator)
    const pinnedChildren = children.slice(0, separatorIndex);
    if (pinnedChildren.some((c) => c.url === url)) return state;

    // Don't add if already tracked
    const dupIds = new Set(state.entries.map((e) => e.duplicateId));
    const untracked = matches.find((m) => !dupIds.has(m.id));
    if (!untracked) return state;

    return addToDynamic(api, state, untracked);
  }

  // Already on toolbar — bump to front of dynamic section
  const entries = reorderEntries(state.entries, match.id);
  await api.moveBookmark(match.id, { parentId: TOOLBAR_ID, index: separatorIndex + 1 });
  return { ...state, entries };
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

export function reorderEntries(entries, movedDuplicateId) {
  const idx = entries.findIndex((e) => e.duplicateId === movedDuplicateId);
  if (idx <= 0) return entries;
  const [entry] = entries.splice(idx, 1);
  return [entry, ...entries];
}
```

- [ ] **Step 3: Run test to verify it passes**

### Sub-task 4c: Handle bookmark created

- [ ] **Step 1: Write test**

```js
describe("handleBookmarkCreated", () => {
  it("creates a duplicate for a new bookmark anywhere (non-toolbar parent)", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const node = await api.createBookmark({ parentId: "work-folder", title: "A", url: "https://a.test" });

    const next = await handleBookmarkCreated(api, state, node.id, node);

    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].originalId).toBe(node.id);
  });

  it("relocates a toolbar-created bookmark to Other Bookmarks and creates a duplicate", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const node = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });

    const next = await handleBookmarkCreated(api, state, node.id, node);

    // Original moved to Other Bookmarks
    const otherChildren = await api.getChildren(OTHER_ID);
    expect(otherChildren.map((n) => n.id)).toContain(node.id);
    // Duplicate on toolbar
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].originalId).toBe(node.id);
  });

  it("does nothing for separator or folder types", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);

    const next = await handleBookmarkCreated(api, state, "some-id", { type: "separator" });

    expect(next).toEqual(state);
  });
});
```

- [ ] **Step 2: Write implementation**

```js
import { TOOLBAR_ID, OTHER_ID } from "../platform/browser-api.js";

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
```

- [ ] **Step 3: Run test to verify it passes**

### Sub-task 4d: Handle bookmark moved

- [ ] **Step 1: Write test**

```js
describe("handleBookmarkMoved", () => {
  it("relocates an untracked bookmark dragged onto toolbar back to its folder and creates duplicate", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    // Simulate drag onto toolbar
    await api.moveBookmark(orig.id, { parentId: TOOLBAR_ID, index: 1 });

    const next = await handleBookmarkMoved(api, state, orig.id, {
      parentId: TOOLBAR_ID,
      index: 1,
      oldParentId: "folder",
      oldIndex: 0,
    });

    expect(await api.getChildren("folder")).toEqual([expect.objectContaining({ id: orig.id })]);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].originalId).toBe(orig.id);
  });

  it("detects cross-separator drag: promotes dynamic item to pinned", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });
    const entries = [{ originalId: orig.id, duplicateId: dup.id }];
    const current = { ...state, entries };
    // separator at index 0, dup at index 1 = dynamic
    // Drag dup before separator (index 0)
    await api.moveBookmark(dup.id, { parentId: TOOLBAR_ID, index: 0 });

    const next = await handleBookmarkMoved(api, current, dup.id, {
      parentId: TOOLBAR_ID,
      index: 0,
      oldParentId: TOOLBAR_ID,
      oldIndex: 1,
    });

    expect(next).toBeDefined();
  });

  it("does nothing for in-section reorder", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test", index: 1 });
    const entries = [{ originalId: "orig", duplicateId: dup.id }];
    const current = { ...state, entries };

    const next = await handleBookmarkMoved(api, current, dup.id, {
      parentId: TOOLBAR_ID,
      index: 2,
      oldParentId: TOOLBAR_ID,
      oldIndex: 1,
    });

    expect(next).toEqual(current);
  });
});
```

- [ ] **Step 2: Write implementation**

```js
export async function handleBookmarkMoved(api, state, id, moveInfo) {
  if (moveInfo.parentId !== TOOLBAR_ID) return state;

  // Find if this is a tracked duplicate
  const entry = state.entries.find((e) => e.duplicateId === id);

  if (!entry) {
    // Untracked item dragged onto toolbar — relocate back, then duplicate
    if (moveInfo.oldParentId && moveInfo.oldParentId !== TOOLBAR_ID) {
      await api.moveBookmark(id, { parentId: moveInfo.oldParentId, index: moveInfo.oldIndex });
      const bookmark = await api.getBookmark(id);
      return addToDynamic(api, state, bookmark);
    }
    return state;
  }

  // Tracked item — check if it crossed the separator
  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);
  const newRegion = moveInfo.index < separatorIndex ? "pinned" : "dynamic";
  const oldRegion = moveInfo.oldIndex < separatorIndex ? "pinned" : "dynamic";

  if (newRegion === oldRegion) return state; // in-section reorder

  // Cross-separator: just update entries to reflect new toolbar order
  const reindexedEntries = state.entries.map((e) => {
    const idx = children.findIndex((c) => c.id === e.duplicateId);
    return { ...e, _pos: idx };
  });
  reindexedEntries.sort((a, b) => a._pos - b._pos);
  const entries = reindexedEntries.map(({ _pos, ...e }) => e);

  return { ...state, entries };
}
```

- [ ] **Step 3: Run test to verify it passes**

### Sub-task 4e: Rename and delete sync

- [ ] **Step 1: Write test**

```js
describe("handleBookmarkChanged", () => {
  it("propagates a rename from the original to its duplicate", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = { separatorId: "s", capacity: 10, entries: [{ originalId: orig.id, duplicateId: dup.id }] };

    await handleBookmarkChanged(api, state, orig.id, { title: "A renamed" });

    expect((await api.getBookmark(dup.id)).title).toBe("A renamed");
  });

  it("propagates a rename from the duplicate back to the original", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = { separatorId: "s", capacity: 10, entries: [{ originalId: orig.id, duplicateId: dup.id }] };

    await handleBookmarkChanged(api, state, dup.id, { title: "A renamed on bar" });

    expect((await api.getBookmark(orig.id)).title).toBe("A renamed on bar");
  });

  it("propagates URL changes both ways", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = { separatorId: "s", capacity: 10, entries: [{ originalId: orig.id, duplicateId: dup.id }] };

    await handleBookmarkChanged(api, state, orig.id, { url: "https://new.test" });

    expect((await api.getBookmark(dup.id)).url).toBe("https://new.test");
  });

  it("does nothing for untracked bookmarks", async () => {
    const api = createFakeBrowserApi();
    const state = { separatorId: "s", capacity: 10, entries: [] };

    const next = await handleBookmarkChanged(api, state, "unknown-id", { title: "X" });

    expect(next).toEqual(state);
  });
});
```

- [ ] **Step 2: Write test for delete**

```js
describe("handleBookmarkRemoved", () => {
  it("removes the duplicate when the original is deleted", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = { separatorId: "s", capacity: 10, entries: [{ originalId: orig.id, duplicateId: dup.id }] };

    const next = await handleBookmarkRemoved(api, state, orig.id);

    expect(next.entries).toEqual([]);
    expect(await api.getBookmark(dup.id)).toBeNull();
  });

  it("cleans up entry when the duplicate is deleted (manual eviction)", async () => {
    const api = createFakeBrowserApi();
    const orig = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = { separatorId: "s", capacity: 10, entries: [{ originalId: orig.id, duplicateId: dup.id }] };

    const next = await handleBookmarkRemoved(api, state, dup.id);

    expect(next.entries).toEqual([]);
    expect(await api.getBookmark(orig.id)).not.toBeNull();
  });

  it("does nothing for untracked bookmarks", async () => {
    const api = createFakeBrowserApi();
    const state = { separatorId: "s", capacity: 10, entries: [] };

    const next = await handleBookmarkRemoved(api, state, "unknown-id");

    expect(next).toEqual(state);
  });
});
```

- [ ] **Step 3: Write implementation**

```js
export async function handleBookmarkChanged(api, state, id, changeInfo) {
  const entry = state.entries.find((e) => e.originalId === id || e.duplicateId === id);
  if (!entry) return state;

  const counterpartId = entry.originalId === id ? entry.duplicateId : entry.originalId;
  await api.updateBookmark(counterpartId, changeInfo);
  return state;
}

export async function handleBookmarkRemoved(api, state, id) {
  const entryIdx = state.entries.findIndex((e) => e.originalId === id || e.duplicateId === id);
  if (entryIdx === -1) return state;

  const entry = state.entries[entryIdx];
  const counterpartId = entry.originalId === id ? entry.duplicateId : entry.originalId;

  // Only remove the counterpart from the toolbar if it still exists
  const counterpart = await api.getBookmark(counterpartId);
  if (counterpart) {
    await api.removeBookmark(counterpartId);
  }

  const entries = [...state.entries];
  entries.splice(entryIdx, 1);
  return { ...state, entries };
}
```

- [ ] **Step 4: Run all event tests together**

Run: `npm test -- tests/background/events.test.js`
Expected: All sub-tasks pass together

- [ ] **Step 5: Commit**

```bash
git add src/background/events.js tests/background/events.test.js
git commit -m "feat: add all event handling (add, bump, promote, demote, rename sync, delete sync)"
```

---

## Task 5: Capacity change handling

- [ ] **Step 1: Write test**

```js
describe("applyCapacityChange", () => {
  it("evicts from the dynamic tail when capacity shrinks", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "folder", title: "B", url: "https://b.test" });
    let current = await handleBookmarkCreated(api, state, a.id, a);
    current = await handleBookmarkCreated(api, current, b.id, b);

    const next = await applyCapacityChange(api, current, 1);

    expect(next.capacity).toBe(1);
    expect(next.entries).toHaveLength(1);
    const toolbar = await api.getChildren(TOOLBAR_ID);
    expect(toolbar.filter((c) => c.type === "bookmark")).toHaveLength(1);
  });

  it("does nothing extra when capacity grows", async () => {
    const api = createFakeBrowserApi();
    const state = await runInstall(api);
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    let current = await handleBookmarkCreated(api, state, a.id, a);

    const next = await applyCapacityChange(api, current, 50);

    expect(next.capacity).toBe(50);
    expect(next.entries).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Write implementation in `events.js`**

```js
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
```

- [ ] **Step 3: Run test to verify it passes**

- [ ] **Step 4: Commit**

```bash
git add src/background/events.js tests/background/events.test.js
git commit -m "feat: add capacity change handling"
```

---

## Task 6: Reentrancy guard

- [ ] **Step 1: Write test**

```js
import { describe, it, expect } from "vitest";
import { createSuppressionGuard } from "../../src/core/guard.js";

describe("createSuppressionGuard", () => {
  it("is not suppressed before any run() call", () => {
    const guard = createSuppressionGuard();
    expect(guard.isSuppressed()).toBe(false);
  });

  it("reports suppressed while run()'s callback is executing", async () => {
    const guard = createSuppressionGuard();
    let sawSuppressedDuring;
    await guard.run(async () => { sawSuppressedDuring = guard.isSuppressed(); });
    expect(sawSuppressedDuring).toBe(true);
    expect(guard.isSuppressed()).toBe(false);
  });

  it("clears suppression even if the callback throws", async () => {
    const guard = createSuppressionGuard();
    await expect(guard.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(guard.isSuppressed()).toBe(false);
  });
});
```

- [ ] **Step 2: Write implementation**

Create `src/core/guard.js`:

```js
export function createSuppressionGuard() {
  let depth = 0;
  return {
    isSuppressed() { return depth > 0; },
    async run(fn) {
      depth += 1;
      try { return await fn(); } finally { depth -= 1; }
    },
  };
}
```

- [ ] **Step 3: Run test**

Run: `npm test -- tests/core/guard.test.js`

- [ ] **Step 4: Commit**

```bash
git add src/core/guard.js tests/core/guard.test.js
git commit -m "feat: add reentrancy guard for self-initiated mutations"
```

---

## Task 7: Background entry point

Wires all modules to the real browser events via the adapter, using the guard to suppress reentrancy.

**Files:**
- Create: `src/background.js`

- [ ] **Step 1: Write the entry point**

```js
import * as api from "./platform/browser-api.js";
import { createSuppressionGuard } from "./core/guard.js";
import { runInstall } from "./background/install.js";
import {
  rebuildFromToolbar,
  handleVisit,
  handleBookmarkCreated,
  handleBookmarkMoved,
  handleBookmarkChanged,
  handleBookmarkRemoved,
  applyCapacityChange,
} from "./background/events.js";
import { TOOLBAR_ID } from "./platform/browser-api.js";

const guard = createSuppressionGuard();
let state;

const ready = guard.run(async () => {
  state = await runInstall(api);
  const entries = await rebuildFromToolbar(api, state);
  if (entries.length > 0) {
    state = { ...state, entries };
    await api.setState(state);
  }
});

api.onUrlVisited(async ({ url }) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleVisit(api, state, url);
    await api.setState(state);
  });
});

api.onBookmarkCreated(async (id, node) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkCreated(api, state, id, node);
    await api.setState(state);
  });
});

api.onBookmarkMoved(async (id, moveInfo) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkMoved(api, state, id, moveInfo);
    await api.setState(state);
  });
});

api.onBookmarkChanged(async (id, changeInfo) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkChanged(api, state, id, changeInfo);
    await api.setState(state);
  });
});

api.onBookmarkRemoved(async (id, removeInfo) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkRemoved(api, state, id);
    await api.setState(state);
  });
});

browser.contextMenus.create({
  id: "bookmark-bar-lru-toggle-pin",
  title: "Pin to bar / Unpin from bar",
  contexts: ["bookmark"],
});

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "bookmark-bar-lru-toggle-pin") return;
  await ready;
  await guard.run(async () => {
    const bookmarkId = info.bookmarkId;
    const children = await api.getChildren(TOOLBAR_ID);
    const separatorIndex = children.findIndex((c) => c.id === state.separatorId);
    const itemIndex = children.findIndex((c) => c.id === bookmarkId);
    if (itemIndex === -1) return;

    const isPinned = itemIndex < separatorIndex;
    if (isPinned) {
      await api.moveBookmark(bookmarkId, { parentId: TOOLBAR_ID, index: separatorIndex + 1 });
    } else {
      await api.moveBookmark(bookmarkId, { parentId: TOOLBAR_ID, index: 0 });
    }

    const entries = await rebuildFromToolbar(api, state);
    state = { ...state, entries };
    await api.setState(state);
  });
});

browser.runtime.onMessage.addListener(async (message) => {
  await ready;
  return guard.run(async () => {
    switch (message.type) {
      case "getSettings":
        return { capacity: state.capacity };
      case "setCapacity":
        state = await applyCapacityChange(api, state, message.capacity);
        await api.setState(state);
        return { ok: true };
      case "rebuild": {
        const entries = await rebuildFromToolbar(api, state);
        state = { ...state, entries };
        await api.setState(state);
        return { ok: true };
      }
      default:
        return undefined;
    }
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/background.js
git commit -m "feat: wire background entry point (listeners, context menu, options messaging)"
```

---

## Task 8: Options page

- [ ] **Step 1: Write `src/options/options.html`**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Bookmark Bar LRU Manager Settings</title>
  </head>
  <body>
    <form id="settings-form">
      <label>
        Dynamic capacity
        <input id="capacity" type="number" min="1" />
      </label>
      <button type="submit">Save</button>
    </form>
    <button id="rebuild">Rebuild toolbar now</button>
    <p id="status"></p>
    <script src="options.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/options/options.js`**

```js
const capacityInput = document.getElementById("capacity");
const form = document.getElementById("settings-form");
const rebuildButton = document.getElementById("rebuild");
const status = document.getElementById("status");

async function load() {
  const settings = await browser.runtime.sendMessage({ type: "getSettings" });
  capacityInput.value = settings.capacity;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await browser.runtime.sendMessage({ type: "setCapacity", capacity: Number(capacityInput.value) });
  status.textContent = "Saved.";
});

rebuildButton.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "rebuild" });
  status.textContent = "Rebuilt.";
});

load();
```

- [ ] **Step 3: Commit**

```bash
git add src/options/options.html src/options/options.js
git commit -m "feat: add options page with capacity setting and rebuild button"
```

---

## Task 9: Full unit test suite sanity check

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: All test files pass. No failures, no skipped tests.

- [ ] **Step 2: If anything fails, fix the implementation**

Re-run `npm test` until everything passes. Do not proceed with a red suite.

---

## Task 10: Manual verification in real Firefox

- [ ] **Step 1: Launch the extension**

Run: `npm start`

- [ ] **Step 2: Verify install/migration**
- Before launch, add 2-3 bookmarks to the toolbar
- After launch: confirm they're archived under Other Bookmarks
- Confirm toolbar shows only the separator

- [ ] **Step 3: Verify dynamic LRU**
- Visit a bookmarked page → duplicate appears after separator
- Visit another → second duplicate appears in front of first
- Revisit the first → it moves to the front
- Set capacity to 2, visit a third → oldest duplicate is evicted

- [ ] **Step 4: Verify promote/demote**
- Right-click a dynamic item → "Pin to bar / Unpin from bar" → moves before separator
- Right-click a pinned item → unpin → moves after separator
- Drag across separator manually → same promote/demote behavior

- [ ] **Step 5: Verify rename sync**
- Rename a bookmark in its origin folder → toolbar duplicate updates
- Rename a toolbar duplicate → original updates

- [ ] **Step 6: Verify new-bookmark flow**
- Bookmark a new page (non-toolbar) → duplicate appears in dynamic section
- Bookmark a new page to the toolbar → original relocated to Other Bookmarks, duplicate appears in dynamic section

- [ ] **Step 7: Verify drag-onto-toolbar**
- Drag a bookmark from a folder onto the toolbar → original stays in folder, duplicate appears on toolbar

- [ ] **Step 8: Record results**
Note any deviations from expected behavior.

---