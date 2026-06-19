/**
 * Reentrancy guard for bookmark event handlers.
 *
 * Firefox fires bookmark events (onCreated, onChanged, etc.) whenever
 * bookmarks change — including changes made by the extension itself.
 * Without a guard, every mutation we make triggers our own listeners,
 * leading to infinite loops.
 *
 * Usage:
 *   const guard = createSuppressionGuard();
 *
 *   // Wrap every mutation the extension performs:
 *   await guard.run(() => api.createBookmark(...));
 *
 *   // In every event listener, skip events we triggered ourselves:
 *   api.onBookmarkCreated(async (id, node) => {
 *     if (guard.isSuppressed()) return;
 *     // ... handle external changes only ...
 *   });
 *
 * Suppression clears in the `finally` block regardless of whether
 * the callback succeeds or throws.
 */
export function createSuppressionGuard() {
  let suppressed = false;
  return {
    isSuppressed() {
      return suppressed;
    },
    async run(fn) {
      suppressed = true;
      try {
        return await fn();
      } finally {
        suppressed = false;
      }
    },
  };
}