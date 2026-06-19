# Bookmark Bar LRU Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Firefox WebExtension that automatically manages the native Bookmarks Toolbar as a pinned section + LRU-capped dynamic section, per `docs/superpowers/specs/2026-06-19-bookmark-bar-lru-design.md`.

**Architecture:** Pure, browser-API-free core logic (`src/core/*`) computes state transitions from events; a thin adapter (`src/platform/browser-api.js`) is the only module that touches `browser.*`; a background script wires adapter events to core logic and applies the resulting side effects via the adapter. This keeps the core unit-testable and the Firefox/Chrome-specific surface minimal for a later port.

**Tech Stack:** Vanilla JavaScript (ES modules), Firefox WebExtensions APIs (`bookmarks`, `history`, `storage`, `contextMenus`), Vitest for unit tests, `web-ext` for manual/integration testing.

---

## File Structure

- `manifest.json` — WebExtension manifest (permissions: `bookmarks`, `history`, `storage`, `contextMenus`)
- `package.json` — Vitest + `web-ext` dev dependencies, test/run scripts
- `src/platform/browser-api.js` — adapter: wraps `browser.bookmarks`/`browser.history`/`browser.storage` behind the operations core logic needs
- `src/core/state.js` — state shape + defaults (`pinnedFolderId`, `separatorId`, `capacity`, `dynamicMap`, `pinnedMap`)
- `src/core/lru.js` — pure functions: `touchDynamic`, `addDynamic`, `evictToCapacity`
- `src/core/pinned.js` — pure functions: `diffPinnedFolder` (folder contents → add/remove duplicate operations)
- `src/core/region.js` — pure functions: `classifyRegion(index, separatorIndex)` → `"pinned" | "dynamic"`, and `decideAction(trackedAs, targetRegion)` → `"promote" | "demote" | "stayPinned" | "stayDynamic"`
- `src/core/folder-tree.js` — pure function: `flattenFolders(treeNode)` → `[{ id, path }]`, used by the options page's folder picker
- `src/core/guard.js` — `createSuppressionGuard()`: lets `background.js` suppress its own listeners while it performs a self-initiated mutation, preventing feedback loops
- `src/background/install.js` — `runInstall(api, now)`: first-run migration of the existing toolbar + initial state setup
- `src/background/pinned-sync.js` — `syncPinnedFolder(api, state)`: applies `diffPinnedFolder` results against the toolbar via the adapter
- `src/background/visits.js` — `handleVisit(api, state, url)`: implements the "Visiting a bookmarked URL" flow
- `src/background/manual-edits.js` — `handleBookmarkCreated` / `handleBookmarkMoved`: implements "Manual edits directly on the toolbar" (relocate-and-promote for untracked arrivals) and the cross-separator promote/demote flow
- `src/background/pin-actions.js` — `promoteToPinned(api, state, originalId)` / `demoteToDynamic(api, state, originalId)`: the shared promote/demote mechanics used by both the context menu and manual-edits flows
- `src/background/sync.js` — `handleBookmarkChanged` / `handleBookmarkRemoved`: implements the "Sync rules" (two-way rename/URL sync, delete-original-removes-duplicate, delete-pinned-duplicate self-heals via `syncPinnedFolder`, delete-dynamic-duplicate is manual eviction)
- `src/background.js` — entry point: imports `src/platform/browser-api.js` and all `src/background/*` modules, registers all listeners, and wires the `contextMenus` items
- `src/options/options.html`, `src/options/options.js` — settings page (pinned folder picker, capacity input, rebuild button)
- `tests/core/*.test.js` — unit tests for every pure core module (`state`, `lru`, `region`, `pinned`, `folder-tree`, `guard`)
- `tests/platform/fake-browser-api.js` — in-memory fake implementing the adapter interface, used by all `tests/background/*` tests
- `tests/background/*.test.js` — tests for `install`, `pinned-sync`, `visits`, `pin-actions`, `manual-edits`, `sync`, `capacity` against the fake adapter

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `manifest.json`
- Create: `vitest.config.js`

- [ ] **Step 1: Create `package.json`**

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

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
  },
});
```

- [ ] **Step 3: Create `manifest.json`**

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
Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Verify the test runner works with zero tests**

Run: `npm test`
Expected: Vitest reports "No test files found" (this is fine — confirms the runner and config load without error). If it errors instead of reporting "no test files", fix `vitest.config.js` before continuing.

- [ ] **Step 6: Initialize git and commit**

```bash
cd /Users/vathsa/Documents/Projects/bookmarkbar
git init
git add package.json manifest.json vitest.config.js docs/
git commit -m "chore: scaffold bookmark bar LRU extension project"
```

## Task 2: Core state shape

**Files:**
- Create: `src/core/state.js`
- Test: `tests/core/state.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { createDefaultState } from "../../src/core/state.js";

describe("createDefaultState", () => {
  it("returns the expected shape with no folder/separator configured yet", () => {
    expect(createDefaultState()).toEqual({
      pinnedFolderId: null,
      separatorId: null,
      capacity: 10,
      dynamicMap: {},
      pinnedMap: {},
    });
  });

  it("allows overriding capacity", () => {
    expect(createDefaultState({ capacity: 50 }).capacity).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/state.test.js`
Expected: FAIL — `Cannot find module '../../src/core/state.js'`

- [ ] **Step 3: Write minimal implementation**

```js
export function createDefaultState(overrides = {}) {
  return {
    pinnedFolderId: null,
    separatorId: null,
    capacity: 10,
    dynamicMap: {},
    pinnedMap: {},
    ...overrides,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core/state.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/state.js tests/core/state.test.js
git commit -m "feat: add default extension state shape"
```

## Task 3: Core LRU order logic

Per the design, toolbar position IS recency — there is no stored timestamp or
persisted order list. These pure functions operate on an `order` array
(most-recent-first list of original bookmark ids) that `background.js` will
derive fresh from the live toolbar via the adapter before calling into this
module, and persist by writing the resulting order back to the toolbar.

**Files:**
- Create: `src/core/lru.js`
- Test: `tests/core/lru.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { touchDynamic, addDynamic, evictToCapacity } from "../../src/core/lru.js";

describe("touchDynamic", () => {
  it("moves an existing id to the front", () => {
    expect(touchDynamic(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("is a no-op if the id is already at the front", () => {
    expect(touchDynamic(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("leaves the order unchanged if the id is not present", () => {
    expect(touchDynamic(["a", "b"], "z")).toEqual(["a", "b"]);
  });
});

describe("addDynamic", () => {
  it("adds a new id to the front with no eviction when under capacity", () => {
    expect(addDynamic(["a", "b"], "c", 5)).toEqual({ order: ["c", "a", "b"], evicted: [] });
  });

  it("evicts the tail when adding exceeds capacity", () => {
    expect(addDynamic(["a", "b", "c"], "d", 3)).toEqual({ order: ["d", "a", "b"], evicted: ["c"] });
  });
});

describe("evictToCapacity", () => {
  it("evicts from the tail until the order fits capacity", () => {
    expect(evictToCapacity(["a", "b", "c", "d"], 2)).toEqual({ order: ["a", "b"], evicted: ["c", "d"] });
  });

  it("evicts nothing when already within capacity", () => {
    expect(evictToCapacity(["a", "b"], 5)).toEqual({ order: ["a", "b"], evicted: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/lru.test.js`
Expected: FAIL — `Cannot find module '../../src/core/lru.js'`

- [ ] **Step 3: Write minimal implementation**

```js
export function touchDynamic(order, id) {
  if (!order.includes(id)) return order;
  return [id, ...order.filter((x) => x !== id)];
}

export function addDynamic(order, id, capacity) {
  const withNew = [id, ...order.filter((x) => x !== id)];
  return evictToCapacity(withNew, capacity);
}

export function evictToCapacity(order, capacity) {
  if (order.length <= capacity) return { order, evicted: [] };
  return {
    order: order.slice(0, capacity),
    evicted: order.slice(capacity),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core/lru.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/lru.js tests/core/lru.test.js
git commit -m "feat: add pure LRU order logic for the dynamic section"
```

## Task 4: Core region/boundary logic

Implements the "Detecting a cross-separator drag" boundary check from the
design as pure, testable functions. `background.js` will call
`classifyRegion` with a live index/separator-index pair read from the
toolbar, then call `decideAction` with what it already knows about the
moved bookmark's tracking status.

**Files:**
- Create: `src/core/region.js`
- Test: `tests/core/region.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { classifyRegion, decideAction } from "../../src/core/region.js";

describe("classifyRegion", () => {
  it("classifies indices before the separator as pinned", () => {
    expect(classifyRegion(0, 3)).toBe("pinned");
    expect(classifyRegion(2, 3)).toBe("pinned");
  });

  it("classifies indices at or after the separator as dynamic", () => {
    expect(classifyRegion(3, 3)).toBe("dynamic");
    expect(classifyRegion(5, 3)).toBe("dynamic");
  });
});

describe("decideAction", () => {
  it("promotes when target is pinned and not currently tracked as pinned", () => {
    expect(decideAction(null, "pinned")).toBe("promote");
    expect(decideAction("dynamic", "pinned")).toBe("promote");
  });

  it("demotes when target is dynamic and currently tracked as pinned", () => {
    expect(decideAction("pinned", "dynamic")).toBe("demote");
  });

  it("stays dynamic when target is dynamic and not currently pinned", () => {
    expect(decideAction(null, "dynamic")).toBe("stayDynamic");
    expect(decideAction("dynamic", "dynamic")).toBe("stayDynamic");
  });

  it("stays pinned when target is pinned and already tracked as pinned", () => {
    expect(decideAction("pinned", "pinned")).toBe("stayPinned");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/region.test.js`
Expected: FAIL — `Cannot find module '../../src/core/region.js'`

- [ ] **Step 3: Write minimal implementation**

```js
export function classifyRegion(index, separatorIndex) {
  return index < separatorIndex ? "pinned" : "dynamic";
}

export function decideAction(trackedAs, targetRegion) {
  if (targetRegion === "pinned") {
    return trackedAs === "pinned" ? "stayPinned" : "promote";
  }
  return trackedAs === "pinned" ? "demote" : "stayDynamic";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core/region.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/region.js tests/core/region.test.js
git commit -m "feat: add pure region classification and promote/demote decision logic"
```

## Task 5: Core pinned-folder diff logic

Implements the "Pinned folder changes" flow from the design: given the
Pinned folder's current contents and the existing `pinnedMap`, compute which
duplicates need to be created, which need to be removed, and the desired
toolbar order — all as data, with no side effects.

**Files:**
- Create: `src/core/pinned.js`
- Test: `tests/core/pinned.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { diffPinnedFolder } from "../../src/core/pinned.js";

describe("diffPinnedFolder", () => {
  it("creates duplicates for originals with none yet", () => {
    const result = diffPinnedFolder(["a", "b"], {});
    expect(result).toEqual({ toCreate: ["a", "b"], toRemove: [], order: ["a", "b"] });
  });

  it("removes duplicates for originals no longer in the folder", () => {
    const result = diffPinnedFolder(["a"], { a: "dup-a", b: "dup-b" });
    expect(result).toEqual({ toCreate: [], toRemove: ["b"], order: ["a"] });
  });

  it("creates nothing and removes nothing when already in sync", () => {
    const result = diffPinnedFolder(["a", "b"], { a: "dup-a", b: "dup-b" });
    expect(result).toEqual({ toCreate: [], toRemove: [], order: ["a", "b"] });
  });

  it("preserves the folder's order even when mixed with creates/removes", () => {
    const result = diffPinnedFolder(["b", "c"], { a: "dup-a", b: "dup-b" });
    expect(result).toEqual({ toCreate: ["c"], toRemove: ["a"], order: ["b", "c"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/pinned.test.js`
Expected: FAIL — `Cannot find module '../../src/core/pinned.js'`

- [ ] **Step 3: Write minimal implementation**

```js
export function diffPinnedFolder(folderOriginalIds, pinnedMap) {
  const tracked = Object.keys(pinnedMap);
  const toCreate = folderOriginalIds.filter((id) => !tracked.includes(id));
  const toRemove = tracked.filter((id) => !folderOriginalIds.includes(id));
  return { toCreate, toRemove, order: [...folderOriginalIds] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core/pinned.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/pinned.js tests/core/pinned.test.js
git commit -m "feat: add pure pinned-folder diff logic"
```

## Task 6: Browser API adapter (Firefox implementation)

This is the only module that touches `browser.*` directly, per the design's
"Browser API abstraction" section. It has no automated test in this task —
`browser.*` only exists inside a real extension context, so it's verified
later via `web-ext run` in Task 12. Keep this module a thin, literal wrapper
with no branching logic, so there's nothing here worth unit-testing in
isolation; all decision logic lives in `src/core/*`.

**Files:**
- Create: `src/platform/browser-api.js`

- [ ] **Step 1: Write the adapter**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add src/platform/browser-api.js
git commit -m "feat: add Firefox browser API adapter"
```

## Task 7: Fake browser API for testing

An in-memory implementation of the same adapter interface as Task 6, used to
unit-test `background.js`'s wiring logic without a real browser. Mirrors a
real but important behavior: actions the fake itself performs (e.g.
`createBookmark`) synchronously fire its own listeners, just like
`browser.bookmarks.create` firing `onCreated` for everyone including the
caller — `background.js` must be written to tolerate that (see Task 8+).

**Files:**
- Create: `tests/platform/fake-browser-api.js`
- Test: `tests/platform/fake-browser-api.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from "vitest";
import { createFakeBrowserApi } from "./fake-browser-api.js";

describe("createFakeBrowserApi", () => {
  it("creates a bookmark, assigns an id, and fires onBookmarkCreated", async () => {
    const api = createFakeBrowserApi();
    const cb = vi.fn();
    api.onBookmarkCreated(cb);

    const node = await api.createBookmark({ parentId: "toolbar", title: "A", url: "https://a.test" });

    expect(node.id).toBeDefined();
    expect(cb).toHaveBeenCalledWith(node.id, expect.objectContaining({ title: "A", url: "https://a.test" }));
  });

  it("returns children sorted by index", async () => {
    const api = createFakeBrowserApi();
    const a = await api.createBookmark({ parentId: "toolbar", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "toolbar", title: "B", url: "https://b.test", index: 0 });

    const children = await api.getChildren("toolbar");
    expect(children.map((n) => n.id)).toEqual([b.id, a.id]);
  });

  it("removes a bookmark and fires onBookmarkRemoved", async () => {
    const api = createFakeBrowserApi();
    const cb = vi.fn();
    api.onBookmarkRemoved(cb);
    const node = await api.createBookmark({ parentId: "toolbar", title: "A", url: "https://a.test" });

    await api.removeBookmark(node.id);

    expect(cb).toHaveBeenCalledWith(node.id, expect.objectContaining({ parentId: "toolbar" }));
    expect(await api.getChildren("toolbar")).toEqual([]);
  });

  it("moves a bookmark and fires onBookmarkMoved with old and new position", async () => {
    const api = createFakeBrowserApi();
    const cb = vi.fn();
    const node = await api.createBookmark({ parentId: "folder-1", title: "A", url: "https://a.test" });
    api.onBookmarkMoved(cb);

    await api.moveBookmark(node.id, { parentId: "toolbar", index: 0 });

    expect(cb).toHaveBeenCalledWith(
      node.id,
      expect.objectContaining({ parentId: "toolbar", index: 0, oldParentId: "folder-1", oldIndex: 0 })
    );
  });

  it("stores and retrieves state", async () => {
    const api = createFakeBrowserApi();
    expect(await api.getState()).toBeNull();
    await api.setState({ capacity: 10 });
    expect(await api.getState()).toEqual({ capacity: 10 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/platform/fake-browser-api.test.js`
Expected: FAIL — `Cannot find module './fake-browser-api.js'`

- [ ] **Step 3: Write minimal implementation**

```js
export function createFakeBrowserApi() {
  let nextId = 1;
  const nodes = new Map();
  const listeners = { created: [], removed: [], changed: [], moved: [], visited: [] };
  let state = null;

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

  return {
    async createBookmark({ parentId, index, title, url, type = "bookmark" }) {
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
      nodes.delete(id);
      reindex(node.parentId);
      listeners.removed.forEach((cb) => cb(id, { parentId: node.parentId, index: node.index }));
    },

    async moveBookmark(id, { parentId, index }) {
      const node = nodes.get(id);
      const oldParentId = node.parentId;
      const oldIndex = node.index;
      node.parentId = parentId;
      node.index = index ?? childrenOf(parentId).length;
      reindex(oldParentId);
      reindex(parentId);
      listeners.moved.forEach((cb) =>
        cb(id, { parentId: node.parentId, index: node.index, oldParentId, oldIndex })
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
      return [...nodes.values()].filter((n) => n.url === url).map((n) => ({ ...n }));
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
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/platform/fake-browser-api.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/platform/fake-browser-api.js tests/platform/fake-browser-api.test.js
git commit -m "test: add in-memory fake browser API for background wiring tests"
```

## Task 8: Install flow

Implements the design's "Install / first run" flow: archive any existing
toolbar contents, create the pinned/dynamic separator, and persist initial
state. Tested against the fake adapter from Task 7 — this is the first
"background-level" test, exercising real (fake) side effects rather than
pure data transforms.

**Files:**
- Create: `src/background/install.js`
- Test: `tests/background/install.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID, OTHER_ID } from "../../src/platform/browser-api.js";
import { runInstall } from "../../src/background/install.js";

describe("runInstall", () => {
  it("creates a separator and default state when the toolbar is empty", async () => {
    const api = createFakeBrowserApi();
    const now = new Date("2026-06-19T00:00:00Z");

    const state = await runInstall(api, now);

    expect(state.separatorId).toBeDefined();
    expect(state.pinnedFolderId).toBeNull();
    expect(state.capacity).toBe(10);
    expect(state.dynamicMap).toEqual({});
    expect(state.pinnedMap).toEqual({});

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren).toEqual([
      expect.objectContaining({ id: state.separatorId, type: "separator" }),
    ]);
  });

  it("archives existing toolbar contents under Other Bookmarks, preserving order", async () => {
    const api = createFakeBrowserApi();
    const first = await api.createBookmark({ parentId: TOOLBAR_ID, title: "First", url: "https://first.test" });
    const second = await api.createBookmark({ parentId: TOOLBAR_ID, title: "Second", url: "https://second.test" });
    const now = new Date("2026-06-19T00:00:00Z");

    await runInstall(api, now);

    const otherChildren = await api.getChildren(OTHER_ID);
    expect(otherChildren).toHaveLength(1);
    const archiveFolder = otherChildren[0];
    expect(archiveFolder.title).toBe("Bookmarks Toolbar archived on 2026-06-19");

    const archived = await api.getChildren(archiveFolder.id);
    expect(archived.map((n) => n.id)).toEqual([first.id, second.id]);

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren).toHaveLength(1);
    expect(toolbarChildren[0].type).toBe("separator");
  });

  it("is idempotent: does nothing if state already exists", async () => {
    const api = createFakeBrowserApi();
    const now = new Date("2026-06-19T00:00:00Z");
    const first = await runInstall(api, now);

    const second = await runInstall(api, now);

    expect(second).toEqual(first);
    expect(await api.getChildren(OTHER_ID)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/background/install.test.js`
Expected: FAIL — `Cannot find module '../../src/background/install.js'`

- [ ] **Step 3: Write minimal implementation**

```js
import { TOOLBAR_ID, OTHER_ID } from "../platform/browser-api.js";
import { createDefaultState } from "../core/state.js";

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

  const state = createDefaultState({ separatorId: separator.id });
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

## Task 9: Pinned folder sync

Implements "Pinned folder changes": applies `diffPinnedFolder` (Task 5)
against the toolbar via the adapter — creating/removing duplicates and
keeping pinned duplicates ordered to match the Pinned folder.

**Files:**
- Create: `src/background/pinned-sync.js`
- Test: `tests/background/pinned-sync.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID } from "../../src/platform/browser-api.js";
import { createDefaultState } from "../../src/core/state.js";
import { syncPinnedFolder } from "../../src/background/pinned-sync.js";

describe("syncPinnedFolder", () => {
  it("does nothing if no pinned folder is configured", async () => {
    const api = createFakeBrowserApi();
    const state = createDefaultState();

    const next = await syncPinnedFolder(api, state);

    expect(next).toEqual(state);
    expect(await api.getChildren(TOOLBAR_ID)).toEqual([]);
  });

  it("creates toolbar duplicates for everything in the pinned folder, in order", async () => {
    const api = createFakeBrowserApi();
    const a = await api.createBookmark({ parentId: "pinned-folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "pinned-folder", title: "B", url: "https://b.test" });
    const state = createDefaultState({ pinnedFolderId: "pinned-folder" });

    const next = await syncPinnedFolder(api, state);

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.title)).toEqual(["A", "B"]);
    expect(Object.keys(next.pinnedMap)).toEqual([a.id, b.id]);
  });

  it("removes the duplicate when an item is removed from the pinned folder", async () => {
    const api = createFakeBrowserApi();
    const a = await api.createBookmark({ parentId: "pinned-folder", title: "A", url: "https://a.test" });
    let state = createDefaultState({ pinnedFolderId: "pinned-folder" });
    state = await syncPinnedFolder(api, state);
    await api.removeBookmark(a.id);

    const next = await syncPinnedFolder(api, state);

    expect(next.pinnedMap).toEqual({});
    expect(await api.getChildren(TOOLBAR_ID)).toEqual([]);
  });

  it("reorders toolbar duplicates when the pinned folder is reordered", async () => {
    const api = createFakeBrowserApi();
    const a = await api.createBookmark({ parentId: "pinned-folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "pinned-folder", title: "B", url: "https://b.test" });
    let state = createDefaultState({ pinnedFolderId: "pinned-folder" });
    state = await syncPinnedFolder(api, state);
    await api.moveBookmark(b.id, { parentId: "pinned-folder", index: 0 });

    await syncPinnedFolder(api, state);

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.title)).toEqual(["B", "A"]);
  });

  it("gracefully handles a deleted pinned folder by treating it as empty", async () => {
    const api = createFakeBrowserApi();
    const a = await api.createBookmark({ parentId: "pinned-folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    let state = createDefaultState({ pinnedFolderId: "pinned-folder", pinnedMap: { [a.id]: dup.id } });
    await api.removeBookmark("pinned-folder");

    const next = await syncPinnedFolder(api, state);

    expect(next.pinnedMap).toEqual({});
    expect(next.pinnedFolderId).toBe("pinned-folder");
    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.id)).not.toContain(dup.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/background/pinned-sync.test.js`
Expected: FAIL — `Cannot find module '../../src/background/pinned-sync.js'`

- [ ] **Step 3: Write minimal implementation**

```js
import { TOOLBAR_ID } from "../platform/browser-api.js";
import { diffPinnedFolder } from "../core/pinned.js";

export async function syncPinnedFolder(api, state) {
  if (!state.pinnedFolderId) return state;

  let children;
  try {
    children = await api.getChildren(state.pinnedFolderId);
  } catch {
    const pinnedMap = { ...state.pinnedMap };
    for (const dupId of Object.values(pinnedMap)) {
      await api.removeBookmark(dupId);
    }
    return { ...state, pinnedMap: {} };
  }

  const folderOriginalIds = children.map((n) => n.id);
  const { toCreate, toRemove, order } = diffPinnedFolder(folderOriginalIds, state.pinnedMap);

  const pinnedMap = { ...state.pinnedMap };

  for (const originalId of toRemove) {
    await api.removeBookmark(pinnedMap[originalId]);
    delete pinnedMap[originalId];
  }

  for (const originalId of toCreate) {
    const original = await api.getBookmark(originalId);
    const duplicate = await api.createBookmark({
      parentId: TOOLBAR_ID,
      title: original.title,
      url: original.url,
    });
    pinnedMap[originalId] = duplicate.id;
  }

  for (let i = 0; i < order.length; i++) {
    await api.moveBookmark(pinnedMap[order[i]], { parentId: TOOLBAR_ID, index: i });
  }

  return { ...state, pinnedMap };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/background/pinned-sync.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/background/pinned-sync.js tests/background/pinned-sync.test.js
git commit -m "feat: add pinned folder sync to toolbar"
```

## Task 10: Visit handling (the dynamic LRU's main entry point)

Implements "Visiting a bookmarked URL (`onUrlVisited`)" from the design:
match the visited URL to an untracked/pinned/dynamic original, and
touch/add/evict accordingly. Uses `touchDynamic`/`addDynamic` from Task 3,
reading and writing the dynamic section's live toolbar order (position is
recency — there is no stored order).

**Files:**
- Create: `src/background/visits.js`
- Test: `tests/background/visits.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID } from "../../src/platform/browser-api.js";
import { createDefaultState } from "../../src/core/state.js";
import { handleVisit } from "../../src/background/visits.js";

async function setupSeparator(api) {
  const separator = await api.createBookmark({ parentId: TOOLBAR_ID, type: "separator" });
  return separator.id;
}

describe("handleVisit", () => {
  it("does nothing when the URL matches no bookmark", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const state = createDefaultState({ separatorId, capacity: 5 });

    const next = await handleVisit(api, state, "https://nowhere.test");

    expect(next).toEqual(state);
  });

  it("does nothing when the URL matches an already-pinned original", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const duplicate = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = createDefaultState({
      separatorId,
      capacity: 5,
      pinnedMap: { [original.id]: duplicate.id },
    });

    const next = await handleVisit(api, state, "https://a.test");

    expect(next).toEqual(state);
  });

  it("creates a dynamic duplicate for a freshly visited, untracked bookmark", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const state = createDefaultState({ separatorId, capacity: 5 });

    const next = await handleVisit(api, state, "https://a.test");

    expect(Object.keys(next.dynamicMap)).toEqual([original.id]);
    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.id)).toEqual([separatorId, next.dynamicMap[original.id]]);
  });

  it("moves an already-dynamic item to the front on revisit", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "folder", title: "B", url: "https://b.test" });
    let state = createDefaultState({ separatorId, capacity: 5 });
    state = await handleVisit(api, state, "https://a.test");
    state = await handleVisit(api, state, "https://b.test");

    state = await handleVisit(api, state, "https://a.test");

    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.id)).toEqual([
      separatorId,
      state.dynamicMap[a.id],
      state.dynamicMap[b.id],
    ]);
  });

  it("evicts the least-recent dynamic duplicate when capacity is exceeded", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "folder", title: "B", url: "https://b.test" });
    let state = createDefaultState({ separatorId, capacity: 1 });
    state = await handleVisit(api, state, "https://a.test");

    state = await handleVisit(api, state, "https://b.test");

    expect(Object.keys(state.dynamicMap)).toEqual([b.id]);
    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.id)).toEqual([separatorId, state.dynamicMap[b.id]]);
  });

  it("does not create duplicate dynamic entries when the same URL is bookmarked in multiple folders", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const a = await api.createBookmark({ parentId: "folder-1", title: "A", url: "https://same.test" });
    const b = await api.createBookmark({ parentId: "folder-2", title: "A also", url: "https://same.test" });
    let state = createDefaultState({ separatorId, capacity: 5 });

    state = await handleVisit(api, state, "https://same.test");

    expect(Object.keys(state.dynamicMap)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/background/visits.test.js`
Expected: FAIL — `Cannot find module '../../src/background/visits.js'`

- [ ] **Step 3: Write minimal implementation**

```js
import { TOOLBAR_ID } from "../platform/browser-api.js";
import { touchDynamic, addDynamic } from "../core/lru.js";

export async function getDynamicOrder(api, state) {
  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);
  const dynamicChildren = children.slice(separatorIndex + 1);
  const reverseMap = new Map(Object.entries(state.dynamicMap).map(([orig, dup]) => [dup, orig]));
  return dynamicChildren.map((c) => reverseMap.get(c.id)).filter(Boolean);
}

export async function applyDynamicOrder(api, state, order, dynamicMap) {
  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);
  for (let i = 0; i < order.length; i++) {
    await api.moveBookmark(dynamicMap[order[i]], { parentId: TOOLBAR_ID, index: separatorIndex + 1 + i });
  }
}

export async function addUntrackedToDynamic(api, state, originalId) {
  const original = await api.getBookmark(originalId);
  const order = await getDynamicOrder(api, state);

  const duplicate = await api.createBookmark({
    parentId: TOOLBAR_ID,
    title: original.title,
    url: original.url,
  });
  const dynamicMap = { ...state.dynamicMap, [originalId]: duplicate.id };
  const { order: newOrder, evicted } = addDynamic(order, originalId, state.capacity);

  for (const evictedId of evicted) {
    await api.removeBookmark(dynamicMap[evictedId]);
    delete dynamicMap[evictedId];
  }

  const nextState = { ...state, dynamicMap };
  await applyDynamicOrder(api, nextState, newOrder, dynamicMap);
  return nextState;
}

export async function handleVisit(api, state, url) {
  const matches = await api.searchBookmarksByUrl(url);
  const duplicateIds = new Set([...Object.values(state.dynamicMap), ...Object.values(state.pinnedMap)]);
  const original = matches.find((m) => !duplicateIds.has(m.id));
  if (!original) return state;

  if (state.pinnedMap[original.id]) return state;

  if (state.dynamicMap[original.id]) {
    const order = await getDynamicOrder(api, state);
    const newOrder = touchDynamic(order, original.id);
    await applyDynamicOrder(api, state, newOrder, state.dynamicMap);
    return state;
  }

  return addUntrackedToDynamic(api, state, original.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/background/visits.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/background/visits.js tests/background/visits.test.js
git commit -m "feat: add dynamic LRU visit handling"
```

## Task 11: Promote/demote mechanics

Implements "Pinning and unpinning" → Promote/Demote from the design (as
corrected: demote relocates the original to Other Bookmarks rather than
deleting it). Shared by both the context menu action (Task 13) and the
cross-separator drag handling (Task 12).

**Files:**
- Create: `src/background/pin-actions.js`
- Test: `tests/background/pin-actions.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID, OTHER_ID } from "../../src/platform/browser-api.js";
import { createDefaultState } from "../../src/core/state.js";
import { promoteToPinned, demoteToDynamic } from "../../src/background/pin-actions.js";

describe("promoteToPinned", () => {
  it("copies the original into the pinned folder and removes the dynamic duplicate", async () => {
    const api = createFakeBrowserApi();
    const separator = await api.createBookmark({ parentId: TOOLBAR_ID, type: "separator" });
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = createDefaultState({
      separatorId: separator.id,
      pinnedFolderId: "pinned-folder",
      dynamicMap: { [original.id]: dup.id },
    });

    const next = await promoteToPinned(api, state, original.id);

    expect(next.dynamicMap).toEqual({});
    expect(Object.keys(next.pinnedMap)).toHaveLength(1);
    const pinnedFolderChildren = await api.getChildren("pinned-folder");
    expect(pinnedFolderChildren).toHaveLength(1);
    expect(pinnedFolderChildren[0].url).toBe("https://a.test");
    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.url)).toEqual(["https://a.test"]);
  });
});

describe("demoteToDynamic", () => {
  it("relocates the pinned original to Other Bookmarks and adds a fresh dynamic duplicate", async () => {
    const api = createFakeBrowserApi();
    const separator = await api.createBookmark({ parentId: TOOLBAR_ID, type: "separator" });
    const original = await api.createBookmark({ parentId: "pinned-folder", title: "A", url: "https://a.test" });
    let state = createDefaultState({ separatorId: separator.id, pinnedFolderId: "pinned-folder", capacity: 5 });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, index: 0, title: "A", url: "https://a.test" });
    state = { ...state, pinnedMap: { [original.id]: dup.id } };

    const next = await demoteToDynamic(api, state, original.id);

    expect(next.pinnedMap).toEqual({});
    expect(Object.keys(next.dynamicMap)).toEqual([original.id]);
    const otherChildren = await api.getChildren(OTHER_ID);
    expect(otherChildren.map((n) => n.id)).toEqual([original.id]);
    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.url)).toEqual(["https://a.test"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/background/pin-actions.test.js`
Expected: FAIL — `Cannot find module '../../src/background/pin-actions.js'`

- [ ] **Step 3: Write minimal implementation**

```js
import { TOOLBAR_ID, OTHER_ID } from "../platform/browser-api.js";
import { syncPinnedFolder } from "./pinned-sync.js";
import { addDynamic } from "../core/lru.js";

export async function promoteToPinned(api, state, originalId) {
  const original = await api.getBookmark(originalId);
  await api.createBookmark({
    parentId: state.pinnedFolderId,
    title: original.title,
    url: original.url,
  });

  const dynamicMap = { ...state.dynamicMap };
  const oldDuplicateId = dynamicMap[originalId];
  if (oldDuplicateId) {
    await api.removeBookmark(oldDuplicateId);
    delete dynamicMap[originalId];
  }

  return syncPinnedFolder(api, { ...state, dynamicMap });
}

export async function demoteToDynamic(api, state, originalId) {
  const duplicateId = state.pinnedMap[originalId];
  const pinnedMap = { ...state.pinnedMap };
  delete pinnedMap[originalId];

  await api.moveBookmark(originalId, { parentId: OTHER_ID });
  if (duplicateId) await api.removeBookmark(duplicateId);

  const children = await api.getChildren(TOOLBAR_ID);
  const separatorIndex = children.findIndex((c) => c.id === state.separatorId);
  const dynamicOriginalIds = Object.keys(state.dynamicMap);
  const { order, evicted } = addDynamic(dynamicOriginalIds, originalId, state.capacity);

  const original = await api.getBookmark(originalId);
  const newDuplicate = await api.createBookmark({
    parentId: TOOLBAR_ID,
    index: separatorIndex + 1,
    title: original.title,
    url: original.url,
  });

  const dynamicMap = { ...state.dynamicMap, [originalId]: newDuplicate.id };
  for (const evictedId of evicted) {
    await api.removeBookmark(dynamicMap[evictedId]);
    delete dynamicMap[evictedId];
  }
  for (let i = 0; i < order.length; i++) {
    await api.moveBookmark(dynamicMap[order[i]], { parentId: TOOLBAR_ID, index: separatorIndex + 1 + i });
  }

  return { ...state, pinnedMap, dynamicMap };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/background/pin-actions.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/background/pin-actions.js tests/background/pin-actions.test.js
git commit -m "feat: add promote/demote mechanics shared by context menu and drag actions"
```

## Task 12: New-bookmark and manual toolbar edit handling

Implements three related design flows that all funnel through
`onBookmarkCreated`/`onBookmarkMoved`: "Creating a new bookmark anywhere"
(every new bookmark promotes to dynamic, regardless of folder), "Manual
edits directly on the toolbar" (relocate-and-promote for untracked
arrivals), and the cross-separator drag mechanics from "Detecting a
cross-separator drag." Reuses `addUntrackedToDynamic` (Task 10) and
`promoteToPinned`/`demoteToDynamic` (Task 11) — this module's job is purely
to classify *which* of those operations a given creation/move event
implies.

**Simplification note:** when a drag crosses the separator, the resulting
promote/demote places the item at the front of its new section rather than
exactly at the drop index — the design allows this ("or front, for the
context-menu action"); this plan applies the same simplification uniformly
rather than threading exact drop-index placement through `pin-actions.js`.

**Files:**
- Create: `src/background/manual-edits.js`
- Test: `tests/background/manual-edits.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID, OTHER_ID } from "../../src/platform/browser-api.js";
import { createDefaultState } from "../../src/core/state.js";
import { handleBookmarkCreated, handleBookmarkMoved } from "../../src/background/manual-edits.js";

async function setupSeparator(api) {
  const separator = await api.createBookmark({ parentId: TOOLBAR_ID, type: "separator" });
  return separator.id;
}

describe("handleBookmarkCreated", () => {
  it("relocates a bookmark created directly on the toolbar to Other Bookmarks and promotes it to dynamic", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const state = createDefaultState({ separatorId, capacity: 5 });
    const node = await api.createBookmark({ parentId: TOOLBAR_ID, index: 1, title: "A", url: "https://a.test" });

    const next = await handleBookmarkCreated(api, state, node.id, node);

    expect(Object.keys(next.dynamicMap)).toEqual([node.id]);
    const otherChildren = await api.getChildren(OTHER_ID);
    expect(otherChildren.map((n) => n.id)).toEqual([node.id]);
  });

  it("promotes a bookmark created in any other folder straight to dynamic, without relocating it", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const state = createDefaultState({ separatorId, capacity: 5 });
    const node = await api.createBookmark({ parentId: "work-folder", title: "A", url: "https://a.test" });

    const next = await handleBookmarkCreated(api, state, node.id, node);

    expect(Object.keys(next.dynamicMap)).toEqual([node.id]);
    expect(await api.getChildren("work-folder")).toEqual([expect.objectContaining({ id: node.id })]);
  });
});

describe("handleBookmarkMoved", () => {
  it("drags an untracked bookmark from a folder onto the dynamic region: relocates back and promotes to dynamic", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const state = createDefaultState({ separatorId, capacity: 5 });
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    await api.moveBookmark(original.id, { parentId: TOOLBAR_ID, index: 1 });

    const next = await handleBookmarkMoved(api, state, original.id, {
      parentId: TOOLBAR_ID,
      index: 1,
      oldParentId: "folder",
      oldIndex: 0,
    });

    expect(Object.keys(next.dynamicMap)).toEqual([original.id]);
    expect(await api.getChildren("folder")).toEqual([expect.objectContaining({ id: original.id })]);
  });

  it("drags an untracked bookmark onto the pinned region: relocates back and promotes to pinned", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const state = createDefaultState({ separatorId, pinnedFolderId: "pinned-folder", capacity: 5 });
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    await api.moveBookmark(original.id, { parentId: TOOLBAR_ID, index: 0 });

    const next = await handleBookmarkMoved(api, state, original.id, {
      parentId: TOOLBAR_ID,
      index: 0,
      oldParentId: "folder",
      oldIndex: 0,
    });

    expect(Object.keys(next.pinnedMap)).toHaveLength(1);
    expect(await api.getChildren("folder")).toEqual([expect.objectContaining({ id: original.id })]);
    const pinnedFolderChildren = await api.getChildren("pinned-folder");
    expect(pinnedFolderChildren.map((n) => n.url)).toEqual(["https://a.test"]);
  });

  it("drags a tracked dynamic duplicate across the separator into the pinned region: promotes", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = createDefaultState({
      separatorId,
      pinnedFolderId: "pinned-folder",
      capacity: 5,
      dynamicMap: { [original.id]: dup.id },
    });
    await api.moveBookmark(dup.id, { parentId: TOOLBAR_ID, index: 0 });

    const next = await handleBookmarkMoved(api, state, dup.id, {
      parentId: TOOLBAR_ID,
      index: 0,
      oldParentId: TOOLBAR_ID,
      oldIndex: 1,
    });

    expect(next.dynamicMap).toEqual({});
    expect(Object.keys(next.pinnedMap)).toEqual([original.id]);
  });

  it("drags a tracked pinned duplicate across the separator into the dynamic region: demotes", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const original = await api.createBookmark({ parentId: "pinned-folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, index: 0, title: "A", url: "https://a.test" });
    const state = createDefaultState({
      separatorId,
      pinnedFolderId: "pinned-folder",
      capacity: 5,
      pinnedMap: { [original.id]: dup.id },
    });
    await api.moveBookmark(dup.id, { parentId: TOOLBAR_ID, index: 2 });

    const next = await handleBookmarkMoved(api, state, dup.id, {
      parentId: TOOLBAR_ID,
      index: 2,
      oldParentId: TOOLBAR_ID,
      oldIndex: 0,
    });

    expect(next.pinnedMap).toEqual({});
    expect(Object.keys(next.dynamicMap)).toEqual([original.id]);
    const otherChildren = await api.getChildren(OTHER_ID);
    expect(otherChildren.map((n) => n.id)).toEqual([original.id]);
  });

  it("does nothing when a tracked dynamic duplicate is reordered within its own section", async () => {
    const api = createFakeBrowserApi();
    const separatorId = await setupSeparator(api);
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, index: 1, title: "A", url: "https://a.test" });
    const other = await api.createBookmark({ parentId: TOOLBAR_ID, index: 2, title: "B", url: "https://b.test" });
    const state = createDefaultState({
      separatorId,
      capacity: 5,
      dynamicMap: { [original.id]: dup.id },
    });
    await api.moveBookmark(dup.id, { parentId: TOOLBAR_ID, index: 2 });

    const next = await handleBookmarkMoved(api, state, dup.id, {
      parentId: TOOLBAR_ID,
      index: 2,
      oldParentId: TOOLBAR_ID,
      oldIndex: 1,
    });

    expect(next).toEqual(state);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/background/manual-edits.test.js`
Expected: FAIL — `Cannot find module '../../src/background/manual-edits.js'`

- [ ] **Step 3: Write minimal implementation**

```js
import { TOOLBAR_ID, OTHER_ID } from "../platform/browser-api.js";
import { classifyRegion, decideAction } from "../core/region.js";
import { addUntrackedToDynamic } from "./visits.js";
import { promoteToPinned, demoteToDynamic } from "./pin-actions.js";

async function getSeparatorIndex(api, state) {
  const children = await api.getChildren(TOOLBAR_ID);
  return children.findIndex((c) => c.id === state.separatorId);
}

function trackedRegionOf(state, duplicateId) {
  if (Object.values(state.pinnedMap).includes(duplicateId)) return "pinned";
  if (Object.values(state.dynamicMap).includes(duplicateId)) return "dynamic";
  return null;
}

function originalForDuplicate(state, duplicateId) {
  for (const [orig, dup] of Object.entries(state.pinnedMap)) if (dup === duplicateId) return orig;
  for (const [orig, dup] of Object.entries(state.dynamicMap)) if (dup === duplicateId) return orig;
  return null;
}

export async function handleBookmarkCreated(api, state, id, node) {
  if (node.type !== "bookmark") return state;

  if (node.parentId !== TOOLBAR_ID) {
    return addUntrackedToDynamic(api, state, id);
  }

  const separatorIndex = await getSeparatorIndex(api, state);
  const region = classifyRegion(node.index, separatorIndex);

  await api.moveBookmark(id, { parentId: OTHER_ID });

  if (region === "pinned") return promoteToPinned(api, state, id);
  return addUntrackedToDynamic(api, state, id);
}

export async function handleBookmarkMoved(api, state, id, moveInfo) {
  if (moveInfo.parentId !== TOOLBAR_ID) return state;

  const separatorIndex = await getSeparatorIndex(api, state);
  const region = classifyRegion(moveInfo.index, separatorIndex);

  const originalId = originalForDuplicate(state, id);
  if (originalId) {
    const trackedAs = trackedRegionOf(state, id);
    const action = decideAction(trackedAs, region);
    if (action === "promote") return promoteToPinned(api, state, originalId);
    if (action === "demote") return demoteToDynamic(api, state, originalId);
    return state;
  }

  await api.moveBookmark(id, { parentId: moveInfo.oldParentId, index: moveInfo.oldIndex });
  if (region === "pinned") return promoteToPinned(api, state, id);
  return addUntrackedToDynamic(api, state, id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/background/manual-edits.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/background/manual-edits.js tests/background/manual-edits.test.js
git commit -m "feat: add manual toolbar edit handling (relocate-and-promote, cross-separator promote/demote)"
```

## Task 13: Rename/delete sync rules

Implements the design's "Sync rules": two-way rename/URL propagation
between an original and its duplicate, removing a duplicate when its
original is deleted, and self-healing a pinned duplicate that was deleted
directly (since the Pinned folder still has the original, the next sync
recreates it — pinned items are meant to be durable). Deleting a dynamic
duplicate directly is manual eviction and intentionally does nothing else.

**Files:**
- Create: `src/background/sync.js`
- Test: `tests/background/sync.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID } from "../../src/platform/browser-api.js";
import { createDefaultState } from "../../src/core/state.js";
import { handleBookmarkChanged, handleBookmarkRemoved } from "../../src/background/sync.js";

describe("handleBookmarkChanged", () => {
  it("propagates a rename from the original to its dynamic duplicate", async () => {
    const api = createFakeBrowserApi();
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = createDefaultState({ dynamicMap: { [original.id]: dup.id } });

    await handleBookmarkChanged(api, state, original.id, { title: "A renamed" });

    expect((await api.getBookmark(dup.id)).title).toBe("A renamed");
  });

  it("propagates a rename from the duplicate back to its pinned original", async () => {
    const api = createFakeBrowserApi();
    const original = await api.createBookmark({ parentId: "pinned-folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = createDefaultState({ pinnedMap: { [original.id]: dup.id } });

    await handleBookmarkChanged(api, state, dup.id, { title: "A renamed on bar" });

    expect((await api.getBookmark(original.id)).title).toBe("A renamed on bar");
  });

  it("propagates a URL change from the original to its dynamic duplicate", async () => {
    const api = createFakeBrowserApi();
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = createDefaultState({ dynamicMap: { [original.id]: dup.id } });

    await handleBookmarkChanged(api, state, original.id, { url: "https://moved.test" });

    expect((await api.getBookmark(dup.id)).url).toBe("https://moved.test");
  });
});

describe("handleBookmarkRemoved", () => {
  it("removes the dynamic duplicate when its original is deleted", async () => {
    const api = createFakeBrowserApi();
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = createDefaultState({ dynamicMap: { [original.id]: dup.id } });

    const next = await handleBookmarkRemoved(api, state, original.id);

    expect(next.dynamicMap).toEqual({});
    expect(await api.getBookmark(dup.id)).toBeNull();
  });

  it("just clears the map entry when a dynamic duplicate is deleted directly (manual eviction)", async () => {
    const api = createFakeBrowserApi();
    const original = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = createDefaultState({ dynamicMap: { [original.id]: dup.id } });

    const next = await handleBookmarkRemoved(api, state, dup.id);

    expect(next.dynamicMap).toEqual({});
    expect(await api.getBookmark(original.id)).not.toBeNull();
  });

  it("self-heals when a pinned duplicate is deleted directly, since the original is still in the Pinned folder", async () => {
    const api = createFakeBrowserApi();
    const original = await api.createBookmark({ parentId: "pinned-folder", title: "A", url: "https://a.test" });
    const dup = await api.createBookmark({ parentId: TOOLBAR_ID, title: "A", url: "https://a.test" });
    const state = createDefaultState({ pinnedFolderId: "pinned-folder", pinnedMap: { [original.id]: dup.id } });

    const next = await handleBookmarkRemoved(api, state, dup.id);

    expect(Object.keys(next.pinnedMap)).toEqual([original.id]);
    expect(next.pinnedMap[original.id]).not.toBe(dup.id);
    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.url)).toEqual(["https://a.test"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/background/sync.test.js`
Expected: FAIL — `Cannot find module '../../src/background/sync.js'`

- [ ] **Step 3: Write minimal implementation**

```js
import { syncPinnedFolder } from "./pinned-sync.js";

function counterpartOf(state, id) {
  for (const [orig, dup] of Object.entries(state.pinnedMap)) {
    if (orig === id) return dup;
    if (dup === id) return orig;
  }
  for (const [orig, dup] of Object.entries(state.dynamicMap)) {
    if (orig === id) return dup;
    if (dup === id) return orig;
  }
  return null;
}

export async function handleBookmarkChanged(api, state, id, changeInfo) {
  const counterpart = counterpartOf(state, id);
  if (!counterpart) return state;
  await api.updateBookmark(counterpart, changeInfo);
  return state;
}

export async function handleBookmarkRemoved(api, state, id) {
  if (state.pinnedMap[id]) {
    const pinnedMap = { ...state.pinnedMap };
    const dup = pinnedMap[id];
    delete pinnedMap[id];
    await api.removeBookmark(dup);
    return { ...state, pinnedMap };
  }

  if (state.dynamicMap[id]) {
    const dynamicMap = { ...state.dynamicMap };
    const dup = dynamicMap[id];
    delete dynamicMap[id];
    await api.removeBookmark(dup);
    return { ...state, dynamicMap };
  }

  const pinnedEntry = Object.entries(state.pinnedMap).find(([, dup]) => dup === id);
  if (pinnedEntry) {
    const pinnedMap = { ...state.pinnedMap };
    delete pinnedMap[pinnedEntry[0]];
    return syncPinnedFolder(api, { ...state, pinnedMap });
  }

  const dynamicEntry = Object.entries(state.dynamicMap).find(([, dup]) => dup === id);
  if (dynamicEntry) {
    const dynamicMap = { ...state.dynamicMap };
    delete dynamicMap[dynamicEntry[0]];
    return { ...state, dynamicMap };
  }

  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/background/sync.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/background/sync.js tests/background/sync.test.js
git commit -m "feat: add rename and delete sync rules"
```

## Task 14: Capacity change handling

Implements "Capacity changed in settings": shrinking capacity evicts from
the tail immediately; growing it takes no immediate action. Reuses
`getDynamicOrder` (now exported from Task 10's `visits.js`) and
`evictToCapacity` (Task 3).

**Files:**
- Create: `src/background/capacity.js`
- Test: `tests/background/capacity.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { createFakeBrowserApi } from "../platform/fake-browser-api.js";
import { TOOLBAR_ID } from "../../src/platform/browser-api.js";
import { createDefaultState } from "../../src/core/state.js";
import { handleVisit } from "../../src/background/visits.js";
import { applyCapacityChange } from "../../src/background/capacity.js";

describe("applyCapacityChange", () => {
  it("evicts from the tail when capacity shrinks below the current count", async () => {
    const api = createFakeBrowserApi();
    const separator = await api.createBookmark({ parentId: TOOLBAR_ID, type: "separator" });
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    const b = await api.createBookmark({ parentId: "folder", title: "B", url: "https://b.test" });
    let state = createDefaultState({ separatorId: separator.id, capacity: 5 });
    state = await handleVisit(api, state, "https://a.test");
    state = await handleVisit(api, state, "https://b.test");

    const next = await applyCapacityChange(api, state, 1);

    expect(next.capacity).toBe(1);
    expect(Object.keys(next.dynamicMap)).toEqual([b.id]);
    const toolbarChildren = await api.getChildren(TOOLBAR_ID);
    expect(toolbarChildren.map((n) => n.id)).toEqual([separator.id, next.dynamicMap[b.id]]);
  });

  it("does nothing extra when capacity grows", async () => {
    const api = createFakeBrowserApi();
    const separator = await api.createBookmark({ parentId: TOOLBAR_ID, type: "separator" });
    const a = await api.createBookmark({ parentId: "folder", title: "A", url: "https://a.test" });
    let state = createDefaultState({ separatorId: separator.id, capacity: 1 });
    state = await handleVisit(api, state, "https://a.test");

    const next = await applyCapacityChange(api, state, 10);

    expect(next.capacity).toBe(10);
    expect(Object.keys(next.dynamicMap)).toEqual([a.id]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/background/capacity.test.js`
Expected: FAIL — `Cannot find module '../../src/background/capacity.js'`

- [ ] **Step 3: Write minimal implementation**

```js
import { evictToCapacity } from "../core/lru.js";
import { getDynamicOrder } from "./visits.js";

export async function applyCapacityChange(api, state, newCapacity) {
  const order = await getDynamicOrder(api, state);
  const { evicted } = evictToCapacity(order, newCapacity);

  const dynamicMap = { ...state.dynamicMap };
  for (const evictedId of evicted) {
    await api.removeBookmark(dynamicMap[evictedId]);
    delete dynamicMap[evictedId];
  }

  return { ...state, capacity: newCapacity, dynamicMap };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/background/capacity.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/background/capacity.js tests/background/capacity.test.js
git commit -m "feat: add capacity change handling"
```

## Task 15: Folder tree flattening (for the options page's folder picker)

A pure function turning the `browser.bookmarks.getTree()` shape into a flat
list of `{ id, path }` folder options, so the options page can render a
`<select>` of every folder by its full path (e.g. `"Other Bookmarks / Work"`)
without the user having to type a bookmark id.

**Files:**
- Create: `src/core/folder-tree.js`
- Test: `tests/core/folder-tree.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { flattenFolders } from "../../src/core/folder-tree.js";

describe("flattenFolders", () => {
  it("flattens nested folders into id/path pairs, skipping the untitled root", () => {
    const tree = {
      id: "root________",
      children: [
        {
          id: "toolbar_____",
          title: "Bookmarks Toolbar",
          children: [],
        },
        {
          id: "unfiled_____",
          title: "Other Bookmarks",
          children: [
            { id: "folder-1", title: "Work", children: [] },
          ],
        },
      ],
    };

    expect(flattenFolders(tree)).toEqual([
      { id: "toolbar_____", path: "Bookmarks Toolbar" },
      { id: "unfiled_____", path: "Other Bookmarks" },
      { id: "folder-1", path: "Other Bookmarks / Work" },
    ]);
  });

  it("excludes plain bookmarks (nodes without a children array)", () => {
    const tree = {
      id: "root________",
      children: [
        {
          id: "unfiled_____",
          title: "Other Bookmarks",
          children: [{ id: "bm-1", title: "A bookmark", url: "https://a.test" }],
        },
      ],
    };

    expect(flattenFolders(tree)).toEqual([{ id: "unfiled_____", path: "Other Bookmarks" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/folder-tree.test.js`
Expected: FAIL — `Cannot find module '../../src/core/folder-tree.js'`

- [ ] **Step 3: Write minimal implementation**

```js
export function flattenFolders(node, path = []) {
  if (!Array.isArray(node.children)) return [];

  const currentPath = node.title ? [...path, node.title] : path;
  const here = node.title ? [{ id: node.id, path: currentPath.join(" / ") }] : [];
  const childEntries = node.children.flatMap((child) => flattenFolders(child, currentPath));

  return [...here, ...childEntries];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core/folder-tree.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/folder-tree.js tests/core/folder-tree.test.js
git commit -m "feat: add folder tree flattening for the options page picker"
```

## Task 16: Reentrancy guard

**Why this is needed:** every mutating flow built so far (`syncPinnedFolder`,
`addUntrackedToDynamic`, `promoteToPinned`, `demoteToDynamic`, `runInstall`)
calls `api.createBookmark`/`moveBookmark`/`removeBookmark`/`updateBookmark`.
In real Firefox (and in the fake adapter, Task 7), those calls fire the
*same* `onBookmarkCreated`/`onBookmarkMoved`/etc. listeners that
`background.js` (Task 17) registers globally — including for mutations the
extension just made to itself. Without a guard, e.g. `promoteToPinned`
creating a copy inside the Pinned folder would itself be picked up by the
generic `onBookmarkCreated` listener and misclassified as a brand new
user-filed bookmark, re-triggering `addUntrackedToDynamic` on it. This
utility lets `background.js` suppress its own listeners for the duration of
any self-initiated operation.

**Files:**
- Create: `src/core/guard.js`
- Test: `tests/core/guard.test.js`

- [ ] **Step 1: Write the failing test**

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

    await guard.run(async () => {
      sawSuppressedDuring = guard.isSuppressed();
    });

    expect(sawSuppressedDuring).toBe(true);
    expect(guard.isSuppressed()).toBe(false);
  });

  it("returns the callback's return value", async () => {
    const guard = createSuppressionGuard();
    const result = await guard.run(async () => 42);
    expect(result).toBe(42);
  });

  it("clears suppression even if the callback throws", async () => {
    const guard = createSuppressionGuard();
    await expect(guard.run(async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(guard.isSuppressed()).toBe(false);
  });

  it("stays suppressed across nested run() calls until the outermost one finishes", async () => {
    const guard = createSuppressionGuard();
    let sawSuppressedAfterInnerReturns;

    await guard.run(async () => {
      await guard.run(async () => {});
      sawSuppressedAfterInnerReturns = guard.isSuppressed();
    });

    expect(sawSuppressedAfterInnerReturns).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/guard.test.js`
Expected: FAIL — `Cannot find module '../../src/core/guard.js'`

- [ ] **Step 3: Write minimal implementation**

```js
export function createSuppressionGuard() {
  let depth = 0;

  return {
    isSuppressed() {
      return depth > 0;
    },
    async run(fn) {
      depth += 1;
      try {
        return await fn();
      } finally {
        depth -= 1;
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core/guard.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/guard.js tests/core/guard.test.js
git commit -m "feat: add reentrancy guard to suppress the extension's own bookmark events"
```

## Task 17: Background entry point (listener + context menu + messaging wiring)

Wires every module built so far to the real `browser.*` events via the
adapter, using the Task 16 guard so the extension's own writes never
re-trigger its own listeners. This file has no automated test — it only
runs inside a real extension context (the `browser` global doesn't exist
under Vitest/Node). It's verified manually in Task 20 via `web-ext run`.
Keep all actual decision logic in the already-tested modules; this file
should only sequence calls.

**Note on concurrency:** the guard is a single shared flag, not a queue. It
correctly suppresses re-entrant events caused by a handler's own writes
while that handler is running, but it does not serialize genuinely
concurrent top-level events (e.g. two rapid-fire bookmark creations whose
async chains interleave). That's an accepted limitation for this
single-user extension, not something this plan builds a full mutex for.

**Files:**
- Create: `src/background.js`

- [ ] **Step 1: Write the entry point**

```js
import * as api from "./platform/browser-api.js";
import { createSuppressionGuard } from "./core/guard.js";
import { flattenFolders } from "./core/folder-tree.js";
import { runInstall } from "./background/install.js";
import { syncPinnedFolder } from "./background/pinned-sync.js";
import { handleVisit } from "./background/visits.js";
import { handleBookmarkCreated, handleBookmarkMoved } from "./background/manual-edits.js";
import { handleBookmarkChanged, handleBookmarkRemoved } from "./background/sync.js";
import { promoteToPinned, demoteToDynamic } from "./background/pin-actions.js";
import { applyCapacityChange } from "./background/capacity.js";

const PIN_TOGGLE_MENU_ID = "bookmark-bar-lru-toggle-pin";

const guard = createSuppressionGuard();
let state;

const ready = guard.run(async () => {
  state = await runInstall(api);
  state = await syncPinnedFolder(api, state);
});

function originalFor(map, duplicateId) {
  const entry = Object.entries(map).find(([, dup]) => dup === duplicateId);
  return entry ? entry[0] : null;
}

api.onUrlVisited(async ({ url }) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleVisit(api, state, url);
  });
});

api.onBookmarkCreated(async (id, node) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkCreated(api, state, id, node);
  });
});

api.onBookmarkMoved(async (id, moveInfo) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkMoved(api, state, id, moveInfo);
  });
});

api.onBookmarkChanged(async (id, changeInfo) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkChanged(api, state, id, changeInfo);
  });
});

api.onBookmarkRemoved(async (id) => {
  if (guard.isSuppressed()) return;
  await ready;
  await guard.run(async () => {
    state = await handleBookmarkRemoved(api, state, id);
  });
});

browser.contextMenus.create({
  id: PIN_TOGGLE_MENU_ID,
  title: "Pin to bar / Unpin from bar",
  contexts: ["bookmark"],
});

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== PIN_TOGGLE_MENU_ID) return;
  await ready;
  await guard.run(async () => {
    const duplicateId = info.bookmarkId;

    const pinnedOriginal = originalFor(state.pinnedMap, duplicateId);
    if (pinnedOriginal) {
      state = await demoteToDynamic(api, state, pinnedOriginal);
      return;
    }
    const dynamicOriginal = originalFor(state.dynamicMap, duplicateId);
    if (dynamicOriginal) {
      state = await promoteToPinned(api, state, dynamicOriginal);
    }
  });
});

browser.runtime.onMessage.addListener(async (message) => {
  await ready;
  return guard.run(async () => {
    switch (message.type) {
      case "getSettings":
        return { pinnedFolderId: state.pinnedFolderId, capacity: state.capacity };
      case "getFolderOptions": {
        const [root] = await api.getFullTree();
        return flattenFolders(root);
      }
      case "setPinnedFolder":
        state = { ...state, pinnedFolderId: message.folderId };
        state = await syncPinnedFolder(api, state);
        return { ok: true };
      case "setCapacity":
        state = await applyCapacityChange(api, state, message.capacity);
        return { ok: true };
      case "rebuild":
        state = await syncPinnedFolder(api, state);
        return { ok: true };
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

## Task 18: Options page

Implements the "Settings (options page)" section: pinned folder picker
(populated from `getFolderOptions`), capacity number input, and a "Rebuild
toolbar now" button. Talks to `background.js` purely via
`browser.runtime.sendMessage`. No automated test — verified manually in
Task 20.

**Files:**
- Create: `src/options/options.html`
- Create: `src/options/options.js`

- [ ] **Step 1: Write `options.html`**

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
        Pinned folder
        <select id="pinned-folder"></select>
      </label>
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

- [ ] **Step 2: Write `options.js`**

```js
const folderSelect = document.getElementById("pinned-folder");
const capacityInput = document.getElementById("capacity");
const form = document.getElementById("settings-form");
const rebuildButton = document.getElementById("rebuild");
const status = document.getElementById("status");

async function load() {
  const [settings, folders] = await Promise.all([
    browser.runtime.sendMessage({ type: "getSettings" }),
    browser.runtime.sendMessage({ type: "getFolderOptions" }),
  ]);

  folderSelect.innerHTML = "";
  for (const folder of folders) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.path;
    folderSelect.appendChild(option);
  }
  if (settings.pinnedFolderId) folderSelect.value = settings.pinnedFolderId;
  capacityInput.value = settings.capacity;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await browser.runtime.sendMessage({ type: "setPinnedFolder", folderId: folderSelect.value });
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
git commit -m "feat: add options page for pinned folder, capacity, and rebuild"
```

## Task 19: Full unit test suite sanity check

**Files:** none (verification-only task)

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: All test files pass (state, lru, region, pinned, folder-tree,
guard under `tests/core/`; install, pinned-sync, visits, pin-actions,
manual-edits, sync, capacity under `tests/background/`; fake-browser-api
under `tests/platform/`). No failures, no skipped tests.

- [ ] **Step 2: If anything fails, fix the implementation (not the test) unless the test itself is wrong**

Re-run `npm test` until everything passes. Do not proceed to Task 20 with a
red suite.

## Task 20: Manual verification in real Firefox

Implements the design's "Manual/integration testing" strategy — the
`bookmarks`/`history` APIs aren't mockable in Node, so this is the only way
to confirm the adapter wiring (Task 6, 16) actually behaves correctly
against the real browser.

**Files:** none (verification-only task)

- [ ] **Step 1: Launch the extension in Firefox**

Run: `npm start` (runs `web-ext run`, which launches a Firefox instance with
the extension loaded and auto-reloads on file changes)

- [ ] **Step 2: Verify install/migration**

Before first launch, manually add 2-3 bookmarks directly to the real
Bookmarks Toolbar (outside the extension) so there's something to migrate.
After launch:
- Confirm those bookmarks now live in a new "Bookmarks Toolbar archived on
  \<today's date\>" folder under Other Bookmarks.
- Confirm the toolbar now shows only a single separator.

- [ ] **Step 3: Verify pinned folder sync**

In the extension's options page (`about:addons` → this extension → Preferences):
- Create a folder named "Pinned" under Other Bookmarks with 2 bookmarks in it.
- Select it as the pinned folder and save.
- Confirm both bookmarks appear on the toolbar, before the separator, in
  folder order.
- Reorder them in the Pinned folder; confirm the toolbar reorders to match.

- [ ] **Step 4: Verify dynamic LRU behavior**

- Visit a bookmarked page (not in the Pinned folder) by clicking its
  bookmark wherever it's filed. Confirm a duplicate appears on the toolbar
  after the separator.
- Visit a second, different bookmarked page. Confirm its duplicate appears
  in front of the first one.
- Revisit the first page. Confirm its duplicate moves back to the front.
- Set capacity to 2 in options, then visit a third distinct bookmarked
  page. Confirm the least-recently-visited duplicate is evicted from the
  toolbar (and that the original bookmark still exists wherever it was
  filed).

- [ ] **Step 5: Verify promote/demote**

- Right-click a dynamic (post-separator) toolbar item and choose the pin
  action. Confirm it moves before the separator and a corresponding entry
  appears in the configured Pinned folder.
- Right-click that same item again and unpin it. Confirm it moves back
  after the separator and its entry leaves the Pinned folder (relocated to
  Other Bookmarks, not deleted).
- Drag a dynamic item across the separator into the pinned region by hand;
  confirm the same promotion happens. Drag a pinned item across into the
  dynamic region; confirm demotion happens.

- [ ] **Step 6: Verify rename sync**

- Rename a bookmark in its origin folder while its duplicate is on the
  toolbar. Confirm the toolbar duplicate's title updates.
- Rename the toolbar duplicate directly. Confirm the origin bookmark's
  title updates to match.

- [ ] **Step 7: Verify manual new-bookmark and drag-onto-toolbar handling**

- Bookmark a new page choosing no folder (default save target). Confirm it
  ends up in Other Bookmarks and a duplicate appears in the dynamic section.
- Drag an existing bookmark from some folder directly onto the toolbar's
  dynamic region. Confirm the original stays in its folder and a duplicate
  appears on the toolbar.

- [ ] **Step 8: Record results**

Note any deviations from the above in a follow-up task/issue rather than
silently reconciling behavior with the spec — if real Firefox behaves
differently from what a unit test assumed (e.g. `bookmarks.onMoved` payload
shape), that's a planning gap to fix, not something to patch over manually
each time.
