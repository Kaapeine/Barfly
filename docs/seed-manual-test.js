/**
 * Seed script for manual testing.
 *
 * 1. Run `npm start` to launch Firefox with BarFly loaded
 * 2. Open the Browser Console (Ctrl+Shift+J)
 * 3. Run: `browser.storage.local.clear()` to reset BarFly state
 * 4. Paste this entire file into the Browser Console and press Enter
 * 5. Go to about:debugging → This Firefox → BarFly → Reload
 *
 * After reload, the toolbar should show:
 *   [Gmail] [Calendar] [Drive] [--- separator ---]
 *
 * Then visit one of the bookmarked sites — a duplicate appears after the separator.
 */

(async () => {
  const TOOLBAR_ID = "toolbar_____";
  const OTHER_ID = "unfiled_____";

  // Clear existing toolbar items (leave separator alone if it exists)
  const toolbar = await browser.bookmarks.getChildren(TOOLBAR_ID);
  for (const b of toolbar) {
    if (b.type === "separator") continue;
    await browser.bookmarks.remove(b.id);
  }

  // 1. Create pinned bookmarks
  const pinned = [
    { title: "Gmail",    url: "https://mail.google.com" },
    { title: "Calendar", url: "https://calendar.google.com" },
    { title: "Drive",    url: "https://drive.google.com" },
  ];
  for (const bm of pinned) {
    await browser.bookmarks.create({ parentId: TOOLBAR_ID, title: bm.title, url: bm.url });
  }

  // 2. Create a folder of bookmarks elsewhere
  const folder = await browser.bookmarks.create({
    parentId: OTHER_ID,
    title: "Read Later",
    type: "folder",
  });

  const toVisit = [
    { title: "Wikipedia",        url: "https://en.wikipedia.org" },
    { title: "GitHub",           url: "https://github.com" },
    { title: "MDN",              url: "https://developer.mozilla.org" },
    { title: "Hacker News",      url: "https://news.ycombinator.com" },
    { title: "Reddit",           url: "https://reddit.com" },
    { title: "Lobsters",         url: "https://lobste.rs" },
    { title: "Dev.to",           url: "https://dev.to" },
    { title: "Stack Overflow",   url: "https://stackoverflow.com" },
    { title: "CSS Tricks",       url: "https://css-tricks.com" },
    { title: "YouTube",          url: "https://youtube.com" },
  ];

  for (const bm of toVisit) {
    await browser.bookmarks.create({ parentId: folder.id, title: bm.title, url: bm.url });
  }

  console.log(`✅ Created ${pinned.length} pinned bookmarks on the toolbar`);
  console.log(`✅ Created ${toVisit.length} bookmarks in "${folder.title}" folder`);
  console.log("");
  console.log("👉 Now reload BarFly: about:debugging → This Firefox → BarFly → Reload");
  console.log("   BarFly will archive those 3 pinned items and create the separator.");
  console.log("");
  console.log("💡 Tip: Also run this to reset BarFly's state first:");
  console.log("   await browser.storage.local.clear()");
})();