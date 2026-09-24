import { createContext } from "react";
export type RootLayoutOutletContext = {
  currentUserId: string | null;
  currentTeamName: string;
  displayName: string;
  colorHex: string | null;
};

export const RootLayoutContext = createContext<RootLayoutOutletContext | null>(null);
