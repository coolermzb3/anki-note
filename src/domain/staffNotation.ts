import type { Staff, StaffNotationMode } from "./types";

export function staffForSingleClefMode(mode: Exclude<StaffNotationMode, "grand">): Staff {
  return mode === "treble-only" ? "treble" : "bass";
}

export function applicableLedgerSetting(
  mode: StaffNotationMode,
  includeInterStaffLedgerSpellings: boolean,
): boolean | undefined {
  return mode === "grand" ? includeInterStaffLedgerSpellings : undefined;
}
