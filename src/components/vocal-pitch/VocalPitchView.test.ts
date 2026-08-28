import { describe, expect, it, vi } from "vitest";

import { hasDraggedFiles, requestDroppedFileImport } from "./VocalPitchView";

describe("vocal pitch file drop", () => {
  it("accepts file drags", () => {
    expect(hasDraggedFiles(["Files"])).toBe(true);
    expect(hasDraggedFiles(["text/plain", "Files"])).toBe(true);
  });

  it("ignores non-file drags", () => {
    expect(hasDraggedFiles([])).toBe(false);
    expect(hasDraggedFiles(["text/plain"])).toBe(false);
  });

  it("runs replacement guard and backup preflight before importing", async () => {
    const file = { name: "voice.webm" } as File;
    const importFile = vi.fn(async () => undefined);
    const runLibraryMutationPreflight = vi.fn(async () => true);
    let guardedImport: (() => void | Promise<void>) | undefined;

    requestDroppedFileImport(file, false, {
      importFile,
      runLibraryMutationPreflight,
      runWithReplacementGuard: (after) => {
        guardedImport = after;
      },
    });

    expect(runLibraryMutationPreflight).not.toHaveBeenCalled();
    expect(importFile).not.toHaveBeenCalled();
    await guardedImport?.();
    expect(runLibraryMutationPreflight).toHaveBeenCalledOnce();
    expect(importFile).toHaveBeenCalledWith(file);
  });

  it("does not import while busy or when backup preflight blocks", async () => {
    const file = { name: "voice.webm" } as File;
    const importFile = vi.fn(async () => undefined);
    let guardedImport: (() => void | Promise<void>) | undefined;
    const runWithReplacementGuard = vi.fn((after: () => void | Promise<void>) => {
      guardedImport = after;
    });

    requestDroppedFileImport(file, true, {
      importFile,
      runLibraryMutationPreflight: vi.fn(async () => true),
      runWithReplacementGuard,
    });
    expect(runWithReplacementGuard).not.toHaveBeenCalled();

    requestDroppedFileImport(file, false, {
      importFile,
      runLibraryMutationPreflight: vi.fn(async () => false),
      runWithReplacementGuard,
    });
    await guardedImport?.();
    expect(runWithReplacementGuard).toHaveBeenCalledOnce();
    expect(importFile).not.toHaveBeenCalled();
  });
});
