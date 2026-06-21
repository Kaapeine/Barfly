import * as api from '../../platform/browser-api.js';

const capacityInput = document.getElementById('capacity');
const form = document.getElementById('settings-form');
const rebuildButton = document.getElementById('rebuild');
const status = document.getElementById('status');
const pauseToggle = document.getElementById('pause-toggle');

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

async function loadSettings() {
  const settings = await api.sendMessage({ type: 'getSettings' });
  if (!settings) {
    // Background not ready yet — retry after a short delay
    setTimeout(loadSettings, 200);
    return;
  }
  capacityInput.value = settings.capacity;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await api.sendMessage({
    type: 'setCapacity',
    capacity: Number(capacityInput.value),
  });
  status.textContent = 'Saved.';
});

rebuildButton.addEventListener('click', async () => {
  await api.sendMessage({ type: 'rebuild' });
  status.textContent = 'Rebuilt.';
});

pauseToggle.addEventListener('change', async () => {
  await api.sendMessage({
    type: 'setPaused',
    paused: pauseToggle.checked,
  });
  status.textContent = pauseToggle.checked
    ? '⏸️ Event handlers paused.'
    : '▶️ Event handlers active.';
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