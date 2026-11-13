import { EMPTY_GROUPS, type GroupsState } from './tab-groups';

/**
 * B2 — the current tab groups (leaf module: tab persistence reads it, the groups service changes it; no store
 * imports here).
 */

let state: GroupsState = EMPTY_GROUPS;
let version = 0;
const listeners = new Set<() => void>();

export function getGroupsState(): GroupsState {
  return state;
}

export function setGroupsState(next: GroupsState): void {
  if (next === state) return;
  state = next;
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeGroups(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function groupsVersion(): number {
  return version;
}
