// Shell-level actions (open dialogs) that pages can trigger.
import { createContext, useContext } from "react";

export type AppActions = { openCreateRoom: () => void; openSettings: () => void };

export const AppActionsContext = createContext<AppActions | null>(null);

export function useAppActions() {
  const ctx = useContext(AppActionsContext);
  if (!ctx) throw new Error("useAppActions must be used inside the app shell");
  return ctx;
}
