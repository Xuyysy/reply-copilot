import {createFollowStore} from "./follow-snapshot-store.js";

// Migrates existing local data in place; never merges two acquisition methods.
const storage=createFollowStore("xrh-follow-internal-v1");
export const saveInternalSnapshot = storage.saveSnapshot;
export const readInternalSnapshot = storage.readSnapshot;
export const removeInternalSnapshot = storage.deleteSnapshot;
export const saveInternalCheckpoint = storage.savePending;
export const readInternalCheckpoint = storage.readPending;
export const clearInternalCheckpoint = storage.clearPending;
