// Shell-level actions (open dialogs) that pages can trigger.
import { createContext, useContext } from "react";

export type AppActions = {
  /** Opens the create dialog for users; visitors get the sign-in prompt instead. */
  openCreateRoom: () => void;
  openSettings: () => void;
  /** Opens the "sign in to join" prompt, naming the room the visitor tried to enter. */
  promptSignIn: (roomName?: string) => void;
};

export const AppActionsContext = createContext<AppActions | null>(null);

export function useAppActions() {
  const ctx = useContext(AppActionsContext);
  if (!ctx) throw new Error("useAppActions must be used inside the app shell");
  return ctx;
}
