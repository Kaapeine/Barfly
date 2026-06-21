import * as api from '../platform/browser-api.js';

// ---------------------------------------------------------------------------
// Settings elements
// ---------------------------------------------------------------------------

const capacityInput = document.getElementById('capacity');
const form = document.getElementById('settings-form');
const rebuildButton = document.getElementById('rebuild');
const status = document.getElementById('status');
const seedButton = document.getElementById('seed');
const resetButton = document.getElementById('reset');
const seedStatus = document.getElementById('seed-status');
const clearAllButton = document.getElementById('clear-all');
const pauseToggle = document.getElementById('pause-toggle');
const stateDisplay = document.getElementById('state-display');

// ---------------------------------------------------------------------------
// Wizard elements
// ---------------------------------------------------------------------------

const overlay = document.getElementById('wizard-overlay');
const steps = document.querySelectorAll('.wizard-step');
const dots = document.querySelectorAll('.wizard-progress .dot');
const archiveBtn = document.getElementById('wizard-archive');
const skipBtn = document.getElementById('wizard-skip');
const backBtns = {
  1: document.getElementById('wizard-back-1'),
  2: document.getElementById('wizard-back-2'),
  3: document.getElementById('wizard-back-3'),
};
const nextBtns = {
  0: document.getElementById('wizard-next-0'),
  2: document.getElementById('wizard-next-2'),
};
const finishBtn = document.getElementById('wizard-finish');
const wizardCapacity = document.getElementById('wizard-capacity');

let currentStep = 0;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function loadSettings() {
  const settings = await api.sendMessage({ type: 'getSettings' });
  if (!settings) {
    // Background not ready yet — retry after a short delay
    setTimeout(loadSettings, 200);
    return;
  }
  capacityInput.value = settings.capacity;
  await refreshState();
}

async function refreshState() {
  const stored = await api.getState();
  stateDisplay.textContent = JSON.stringify(stored ?? 'null', null, 2);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await api.sendMessage({
    type: 'setCapacity',
    capacity: Number(capacityInput.value),
  });
  status.textContent = 'Saved.';
  await refreshState();
});

rebuildButton.addEventListener('click', async () => {
  await api.sendMessage({ type: 'rebuild' });
  status.textContent = 'Rebuilt.';
  await refreshState();
});

seedButton.addEventListener('click', async () => {
  seedButton.disabled = true;
  seedStatus.textContent = 'Creating bookmarks...';
  seedStatus.style.color = '#8e8e93';

  try {
    const toolbar = await api.getChildren(api.TOOLBAR_ID);
    for (const b of toolbar) {
      if (b.type === 'separator') continue;
      await api.removeBookmark(b.id);
    }

    const pinned = [
      { title: 'Gmail', url: 'https://mail.google.com' },
      { title: 'Calendar', url: 'https://calendar.google.com' },
      { title: 'Drive', url: 'https://drive.google.com' },
    ];
    for (const bm of pinned) {
      await api.createBookmark({
        parentId: api.TOOLBAR_ID,
        title: bm.title,
        url: bm.url,
      });
    }

    const folder = await api.createBookmark({
      parentId: api.OTHER_ID,
      title: 'Read Later',
      type: 'folder',
    });

    const toVisit = [
      { title: 'Wikipedia', url: 'https://en.wikipedia.org' },
      { title: 'GitHub', url: 'https://github.com' },
      { title: 'MDN', url: 'https://developer.mozilla.org' },
      { title: 'Hacker News', url: 'https://news.ycombinator.com' },
      { title: 'Reddit', url: 'https://reddit.com' },
      { title: 'Lobsters', url: 'https://lobste.rs' },
      { title: 'Dev.to', url: 'https://dev.to' },
      { title: 'Stack Overflow', url: 'https://stackoverflow.com' },
      { title: 'CSS Tricks', url: 'https://css-tricks.com' },
      { title: 'YouTube', url: 'https://youtube.com' },
    ];

    for (const bm of toVisit) {
      await api.createBookmark({
        parentId: folder.id,
        title: bm.title,
        url: bm.url,
      });
    }

    await api.clearStorage();
    await refreshState();

    seedStatus.textContent = `✅ Created ${pinned.length} pinned + ${toVisit.length} bookmarks. Reload BarFly (about:debugging → Reload) to see the separator.`;
    seedStatus.style.color = '#34c759';
  } catch (err) {
    seedStatus.textContent = `Error: ${err.message}`;
    seedStatus.style.color = '#ff3b30';
  } finally {
    seedButton.disabled = false;
  }
});

resetButton.addEventListener('click', async () => {
  resetButton.disabled = true;
  try {
    await api.clearStorage();
    await refreshState();
    seedStatus.textContent =
      '✅ BarFly state cleared. Reload the extension (about:debugging → Reload) for a fresh start.';
    seedStatus.style.color = '#34c759';
  } catch (err) {
    seedStatus.textContent = `Error: ${err.message}`;
    seedStatus.style.color = '#ff3b30';
  } finally {
    resetButton.disabled = false;
  }
});

clearAllButton.addEventListener('click', async () => {
  if (!confirm('Delete ALL bookmarks? This cannot be undone.')) return;
  clearAllButton.disabled = true;
  seedStatus.textContent = 'Deleting all bookmarks...';
  seedStatus.style.color = '#8e8e93';

  try {
    const tree = await api.getFullTree();
    const roots = tree[0]?.children ?? [];
    for (const root of roots) {
      for (const child of root.children ?? []) {
        await api.removeTree(child.id);
      }
    }
    await api.clearStorage();
    await refreshState();
    seedStatus.textContent =
      '✅ All bookmarks deleted. Reload BarFly for a clean start.';
    seedStatus.style.color = '#34c759';
  } catch (err) {
    seedStatus.textContent = `Error: ${err.message}`;
    seedStatus.style.color = '#ff3b30';
  } finally {
    clearAllButton.disabled = false;
  }
});

pauseToggle.addEventListener('change', async () => {
  await api.sendMessage({
    type: 'setPaused',
    paused: pauseToggle.checked,
  });
  seedStatus.textContent = pauseToggle.checked
    ? '⏸️ Event handlers paused.'
    : '▶️ Event handlers active.';
  seedStatus.style.color = '#8e8e93';
});

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

function showStep(step) {
  steps.forEach((s) => {
    s.style.display = Number(s.dataset.step) === step ? '' : 'none';
  });
  dots.forEach((d) => {
    d.classList.toggle('active', Number(d.dataset.step) <= step);
  });
  currentStep = step;
}

async function archiveToolbar() {
  const toolbar = await api.getChildren(api.TOOLBAR_ID);
  const bookmarks = toolbar.filter((b) => b.type !== 'separator');
  if (bookmarks.length === 0) return;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const archiveFolder = await api.createBookmark({
    parentId: api.OTHER_ID,
    title: `Bookmarks Toolbar archived on ${dateStr}`,
    type: 'folder',
  });
  for (const bm of bookmarks) {
    await api.moveBookmark(bm.id, { parentId: archiveFolder.id });
  }
}

archiveBtn.addEventListener('click', async () => {
  archiveBtn.disabled = true;
  archiveBtn.textContent = 'Archiving...';
  await archiveToolbar();
  showStep(3);
});

skipBtn.addEventListener('click', () => {
  showStep(3);
});

nextBtns[0].addEventListener('click', () => showStep(1));
backBtns[1].addEventListener('click', () => showStep(0));

nextBtns[2].addEventListener('click', () => {
  // If archive step is hidden (no bookmarks), skip to Capacity
  const archiveStep = document.querySelector('[data-step="2"]');
  if (archiveStep.style.display === 'none') {
    showStep(3);
  } else {
    showStep(2);
  }
});

backBtns[2].addEventListener('click', () => showStep(1));

backBtns[3].addEventListener('click', () => {
  // If archive step is hidden (no bookmarks), go back to How it works
  const archiveStep = document.querySelector('[data-step="2"]');
  if (archiveStep.style.display === 'none') {
    showStep(1);
  } else {
    showStep(2);
  }
});

finishBtn.addEventListener('click', async () => {
  finishBtn.disabled = true;
  finishBtn.textContent = 'Starting...';

  const capacity = Number(wizardCapacity.value) || 10;

  try {
    await api.sendMessage({
      type: 'setupComplete',
      capacity,
    });
  } catch {
    // Background may have restarted — the setup was already processed.
    // Reload the page to establish a fresh connection.
  }

  // Reload to get a clean runtime connection with all listeners in place
  window.location.reload();
});

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

async function load() {
  // Check if opened with an alert message (separator deleted)
  const params = new URLSearchParams(window.location.search);
  const alertMsg = params.get('alert');
  if (alertMsg) {
    setTimeout(() => {
      window.alert(alertMsg);
    }, 500);
  }

  const setupComplete = await api.getSetupComplete();

  if (!setupComplete) {
    overlay.style.display = 'flex';
    // Check if toolbar has bookmarks for the archive step
    const toolbar = await api.getChildren(api.TOOLBAR_ID);
    const hasBookmarks = toolbar.some((b) => b.type !== 'separator');

    if (hasBookmarks) {
      showStep(0); // Start at Welcome
    } else {
      // No bookmarks — skip archive step (step 2)
      document.querySelector('[data-step="2"]').style.display = 'none';
      showStep(0);
    }
    return;
  }

  await loadSettings();
}

load();
