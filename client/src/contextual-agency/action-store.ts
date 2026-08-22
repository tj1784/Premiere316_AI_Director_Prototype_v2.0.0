import { create } from "zustand";
import type { AssetActionIntent, AssetActionName } from "./types";
import type { ContextualResult } from "./attach-protocol";

type AgencyState = {
  intent: AssetActionIntent | null;
  mode: AssetActionName;
  lastResult: ContextualResult | null;
  returnFocusId: string | null;
  open: (intent: AssetActionIntent) => void;
  setMode: (mode: AssetActionName) => void;
  close: () => void;
  complete: (result: ContextualResult) => void;
};

export const useAssetActionStore = create<AgencyState>((set, get) => ({
  intent: null,
  mode: "choose",
  lastResult: null,
  returnFocusId: null,
  open: (intent) => {
    const returnFocusId = intent.returnFocusId || (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement.id || null : null);
    set({
      intent,
      mode: intent.initialAction || "choose",
      lastResult: null,
      returnFocusId
    });
  },
  setMode: (mode) => set({ mode }),
  close: () => {
    const { returnFocusId } = get();
    set({ intent: null, lastResult: null });
    if (returnFocusId && typeof document !== "undefined") {
      const node = document.getElementById(returnFocusId);
      if (node) {
        node.focus();
        node.classList.add("agency-return-focus");
        window.setTimeout(() => node.classList.remove("agency-return-focus"), 2400);
      }
    }
  },
  complete: (result) => set({ lastResult: result })
}));

export function openAssetAction(intent: AssetActionIntent) {
  useAssetActionStore.getState().open(intent);
}
