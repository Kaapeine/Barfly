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