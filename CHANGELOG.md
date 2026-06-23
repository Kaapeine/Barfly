# Changelog

All notable changes to BarFly are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-06-23

### Added
- Bookmarks created directly on the toolbar are relocated into a dedicated
  "Saved to Bookmarks Toolbar" folder, leaving a tracked duplicate on the bar.

### Changed
- Migrated to Manifest V3. State and self-event suppression now persist across
  service-worker restarts, and event listeners register synchronously so the
  worker wakes reliably. Minimum Firefox raised from 112 to 115.
- On startup, a toolbar bookmark with no matching original is now **adopted**
  (a backing original is created in "Saved to Bookmarks Toolbar" and the
  toolbar item is kept in place) instead of being deleted.

### Fixed
- Dragging multiple bookmarks onto the toolbar at once no longer permanently
  deletes some of them. Two distinct causes were fixed: a startup rebuild
  racing the drag events, and capacity eviction removing not-yet-processed
  drag siblings.
- Deleting a folder of bookmarks now removes their toolbar duplicates instead
  of leaving them orphaned (Firefox reports folder deletion as a single event
  covering the whole subtree).
- Dragging a folder or separator onto the toolbar no longer creates a broken,
  URL-less bookmark.
- Dragging a bookmark that is already represented on the toolbar no longer
  creates a redundant second copy.
- Restored missing browser-adapter exports and corrected event-page listener
  timing.
- Declared `data_collection_permissions` and a stable extension ID for AMO
  submission.

## [1.0.0] - 2026-06-22

### Added
- Initial release: a smart bookmarks toolbar that keeps pinned items up front
  and an LRU-cached set of dynamic items after a separator.

[1.1.0]: https://github.com/Kaapeine/Barfly/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Kaapeine/Barfly/releases/tag/v1.0.0
