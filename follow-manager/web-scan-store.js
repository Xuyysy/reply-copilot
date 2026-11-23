import {createFollowStore} from "./follow-snapshot-store.js";

// Migrates existing local data in place; never merges two acquisition methods.
const storage=createFollowStore("xrh-follow-web-v1");
export const saveWebSnapshot = storage.saveSnapshot;
export const readWebSnapshot = storage.readSnapshot;
export const removeWebSnapshot = storage.deleteSnapshot;
export const saveWebCheckpoint = storage.savePending;
export const readWebCheckpoint = storage.readPending;
export const clearWebCheckpoint = storage.clearPending;
