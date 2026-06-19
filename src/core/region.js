export function classifyRegion(index, separatorIndex) {
  return index < separatorIndex ? "pinned" : "dynamic";
}

export function decideAction(trackedAs, targetRegion) {
  if (targetRegion === "pinned") {
    return trackedAs === "pinned" ? "stayPinned" : "promote";
  }
  return trackedAs === "pinned" ? "demote" : "stayDynamic";
}