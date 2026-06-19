import { TOOLBAR_ID, OTHER_ID } from "../platform/firefox-browser-api.js";
import { classifyRegion, decideAction } from "../core/region.js";
import { addUntrackedOriginalToDynamic } from "./visits.js";
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
    return addUntrackedOriginalToDynamic(api, state, id);
  }

  const separatorIndex = await getSeparatorIndex(api, state);
  const region = classifyRegion(node.index, separatorIndex);

  await api.moveBookmark(id, { parentId: OTHER_ID });

  if (region === "pinned") return promoteToPinned(api, state, id);
  return addUntrackedOriginalToDynamic(api, state, id);
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
  return addUntrackedOriginalToDynamic(api, state, id);
}
