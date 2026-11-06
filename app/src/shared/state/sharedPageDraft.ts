import { atom } from "jotai";

// The shell's logout is an action, not a Router navigation. Keep its guard in sync
// with the page editor's unsaved/in-flight state without sharing document content.
export const sharedPageDraftDirtyAtom = atom(false);
