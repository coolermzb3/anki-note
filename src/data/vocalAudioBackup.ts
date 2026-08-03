import type {
  VocalAudioCounts,
  VocalAudioMaterial,
  VocalPitchAnalysis,
  VocalPitchAnalysisConfig,
} from "../domain/vocalPitch";
import type { BackupDayFileMetadata } from "../domain/types";
import { digestBlob } from "./blobDigest";
import { getBackupState, listVocalAudioMaterials, replaceVocalAudioMaterials } from "./db";

interface VocalAudioBackupEntry {
  analysisDigest?: string;
  analysisFileName?: string;
  audioFileName: string;
  config: VocalPitchAnalysisConfig;
  contentDigest: string;
  createdAt: string;
  durationSeconds: number;
  id: string;
  mimeType: string;
  name: string;
  originalFileName?: string;
  size: number;
  source: VocalAudioMaterial["source"];
  updatedAt: string;
}

interface VocalAudioBackupIndex {
  materials: VocalAudioBackupEntry[];
  schemaVersion: 1;
  updatedAt: string;
}

export type VocalAudioBackupStatus = "backed-up" | "browser-only" | "failed" | "out-of-sync";

export interface VocalAudioBackupFacts {
  counts: VocalAudioCounts;
  digest: string;
  fileMetadata: Record<string, BackupDayFileMetadata>;
  filesValid: boolean;
  hasIndex: boolean;
  metadataChanged: boolean;
}

function countEntries(entries: readonly VocalAudioBackupEntry[]): VocalAudioCounts {
  return {
    materialCount: entries.length,
    recordingCount: entries.filter((entry) => entry.source === "recording").length,
    uploadCount: entries.filter((entry) => entry.source === "upload").length,
  };
}

function extensionFor(material: VocalAudioMaterial): string {
  const originalExtension = material.originalFileName?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (originalExtension) {
    return originalExtension.toLowerCase();
  }
  if (material.mimeType.includes("wav")) return "wav";
  if (material.mimeType.includes("mpeg")) return "mp3";
  if (material.mimeType.includes("mp4")) return "m4a";
  if (material.mimeType.includes("ogg")) return "ogg";
  return "webm";
}

async function writeFile(directory: FileSystemDirectoryHandle, filename: string, data: Blob | string): Promise<void> {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

async function readIndex(directory: FileSystemDirectoryHandle): Promise<VocalAudioBackupIndex | null> {
  try {
    const file = await (await directory.getFileHandle("index.json")).getFile();
    const parsed = JSON.parse(await file.text()) as VocalAudioBackupIndex;
    return parsed.schemaVersion === 1 && Array.isArray(parsed.materials) ? parsed : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return null;
    }
    throw error;
  }
}

async function readOptionalAnalysis(
  directory: FileSystemDirectoryHandle,
  filename: string | undefined,
  expectedDigest: string | undefined,
): Promise<VocalPitchAnalysis | undefined> {
  if (!filename) return undefined;
  const file = await (await directory.getFileHandle(filename)).getFile();
  const text = await file.text();
  if (expectedDigest && (await digestText(text)) !== expectedDigest) {
    throw new Error("清唱分析缓存校验失败");
  }
  return JSON.parse(text) as VocalPitchAnalysis;
}

async function digestText(value: string): Promise<string> {
  return digestBlob(new Blob([value]));
}

async function hasWritePermission(directoryHandle: FileSystemDirectoryHandle): Promise<boolean> {
  if ((await directoryHandle.queryPermission?.({ mode: "readwrite" })) === "granted") {
    return true;
  }
  return (await directoryHandle.requestPermission?.({ mode: "readwrite" })) === "granted";
}

async function toEntry(material: VocalAudioMaterial): Promise<VocalAudioBackupEntry> {
  return {
    id: material.id,
    name: material.name,
    source: material.source,
    mimeType: material.mimeType,
    size: material.size,
    durationSeconds: material.durationSeconds,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
    contentDigest: material.contentDigest,
    config: material.config,
    originalFileName: material.originalFileName,
    audioFileName: `${material.id}.${extensionFor(material)}`,
    analysisDigest: material.analysis ? await digestText(JSON.stringify(material.analysis)) : undefined,
    analysisFileName: material.analysis ? `${material.id}.analysis.json` : undefined,
  };
}

function canonicalEntry(entry: VocalAudioBackupEntry): VocalAudioBackupEntry {
  return {
    analysisDigest: entry.analysisDigest,
    analysisFileName: entry.analysisFileName,
    audioFileName: entry.audioFileName,
    config: {
      maxFrequencyHz: entry.config.maxFrequencyHz,
      minFrequencyHz: entry.config.minFrequencyHz,
      referencePitchHz: entry.config.referencePitchHz,
      smoothing: entry.config.smoothing,
      voicingThreshold: entry.config.voicingThreshold,
    },
    contentDigest: entry.contentDigest,
    createdAt: entry.createdAt,
    durationSeconds: entry.durationSeconds,
    id: entry.id,
    mimeType: entry.mimeType,
    name: entry.name,
    originalFileName: entry.originalFileName,
    size: entry.size,
    source: entry.source,
    updatedAt: entry.updatedAt,
  };
}

async function digestEntries(entries: readonly VocalAudioBackupEntry[]): Promise<string> {
  return digestText(JSON.stringify([...entries].sort((a, b) => a.id.localeCompare(b.id)).map(canonicalEntry)));
}

function metadataMatches(
  remembered: Record<string, BackupDayFileMetadata> | undefined,
  current: Record<string, BackupDayFileMetadata>,
): boolean {
  if (!remembered) return true;
  const filenames = Object.keys(current);
  return (
    filenames.length === Object.keys(remembered).length &&
    filenames.every((filename) => {
      const before = remembered[filename];
      const now = current[filename];
      return before?.size === now.size && before.lastModified === now.lastModified;
    })
  );
}

export async function getVocalAudioLibraryDigest(): Promise<string> {
  return digestEntries(await Promise.all((await listVocalAudioMaterials()).map(toEntry)));
}

export async function inspectVocalAudioBackup(
  directoryHandle: FileSystemDirectoryHandle,
  rememberedMetadata?: Record<string, BackupDayFileMetadata>,
  verifyContents = false,
): Promise<VocalAudioBackupFacts> {
  let audioDirectory: FileSystemDirectoryHandle;
  try {
    audioDirectory = await directoryHandle.getDirectoryHandle("audio");
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return {
        digest: await digestEntries([]),
        fileMetadata: {},
        filesValid: true,
        hasIndex: false,
        metadataChanged: Object.keys(rememberedMetadata ?? {}).length > 0,
        counts: countEntries([]),
      };
    }
    throw error;
  }
  const index = await readIndex(audioDirectory);
  if (!index) {
    return {
      digest: await digestEntries([]),
      fileMetadata: {},
      filesValid: true,
      hasIndex: false,
      metadataChanged: Object.keys(rememberedMetadata ?? {}).length > 0,
      counts: countEntries([]),
    };
  }

  const filenames = [
    "index.json",
    ...index.materials.flatMap((entry) => [entry.audioFileName, entry.analysisFileName].filter(Boolean) as string[]),
  ];
  const fileMetadata: Record<string, BackupDayFileMetadata> = {};
  let filesValid = true;
  for (const filename of filenames) {
    try {
      const file = await (await audioDirectory.getFileHandle(filename)).getFile();
      fileMetadata[filename] = { size: file.size, lastModified: file.lastModified };
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        filesValid = false;
        continue;
      }
      throw error;
    }
  }
  const metadataUnchanged = metadataMatches(rememberedMetadata, fileMetadata);
  if (filesValid && (verifyContents || !metadataUnchanged)) {
    for (const entry of index.materials) {
      const audio = await (await audioDirectory.getFileHandle(entry.audioFileName)).getFile();
      if (audio.size !== entry.size || (await digestBlob(audio)) !== entry.contentDigest) {
        filesValid = false;
        break;
      }
      if (entry.analysisFileName) {
        try {
          const analysisText = await (await (await audioDirectory.getFileHandle(entry.analysisFileName)).getFile()).text();
          JSON.parse(analysisText);
          if (entry.analysisDigest && (await digestText(analysisText)) !== entry.analysisDigest) {
            filesValid = false;
            break;
          }
        } catch {
          filesValid = false;
          break;
        }
      }
    }
  }

  return {
    digest: await digestEntries(index.materials),
    fileMetadata,
    filesValid,
    hasIndex: true,
    metadataChanged: !metadataUnchanged,
    counts: countEntries(index.materials),
  };
}

export async function getVocalAudioBackupStatus(
  directoryHandle: FileSystemDirectoryHandle | undefined,
): Promise<VocalAudioBackupStatus> {
  if (!directoryHandle) {
    return "browser-only";
  }
  try {
    if ((await directoryHandle.queryPermission?.({ mode: "readwrite" })) !== "granted") {
      return "browser-only";
    }
    const [browserDigest, state] = await Promise.all([getVocalAudioLibraryDigest(), getBackupState()]);
    const backup = await inspectVocalAudioBackup(directoryHandle, state.lastSeenVocalAudioFileMetadata);
    return backup.filesValid && browserDigest === backup.digest ? "backed-up" : "out-of-sync";
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return (await listVocalAudioMaterials()).length === 0 ? "backed-up" : "out-of-sync";
    }
    return "failed";
  }
}

export async function syncVocalAudioLibrary(
  directoryHandle: FileSystemDirectoryHandle | undefined,
  { forceRewrite = false }: { forceRewrite?: boolean } = {},
): Promise<VocalAudioBackupStatus> {
  if (!directoryHandle) {
    return "browser-only";
  }
  if (!(await hasWritePermission(directoryHandle))) {
    return "browser-only";
  }
  try {
    const materials = await listVocalAudioMaterials();
    const audioDirectory = await directoryHandle.getDirectoryHandle("audio", { create: true });
    const previousIndex = await readIndex(audioDirectory);
    const previousById = new Map(previousIndex?.materials.map((entry) => [entry.id, entry]) ?? []);
    const nextEntries = await Promise.all(materials.map(toEntry));
    const nextById = new Map(nextEntries.map((entry) => [entry.id, entry]));

    for (const material of materials) {
      const entry = nextById.get(material.id)!;
      const previous = previousById.get(material.id);
      if (
        forceRewrite ||
        previous?.contentDigest !== material.contentDigest ||
        previous?.audioFileName !== entry.audioFileName
      ) {
        await writeFile(audioDirectory, entry.audioFileName, material.audioBlob);
      }
      if (
        material.analysis &&
        (forceRewrite ||
          previous?.analysisDigest !== entry.analysisDigest ||
          previous?.analysisFileName !== entry.analysisFileName)
      ) {
        await writeFile(audioDirectory, entry.analysisFileName!, JSON.stringify(material.analysis satisfies VocalPitchAnalysis));
      }
    }

    const nextFiles = new Set(nextEntries.flatMap((entry) => [entry.audioFileName, entry.analysisFileName].filter(Boolean) as string[]));
    for (const previous of previousIndex?.materials ?? []) {
      for (const filename of [previous.audioFileName, previous.analysisFileName]) {
        if (filename && !nextFiles.has(filename)) {
          await audioDirectory.removeEntry(filename).catch((error) => {
            if (!(error instanceof DOMException && error.name === "NotFoundError")) {
              throw error;
            }
          });
        }
      }
    }

    if (!previousIndex || (await digestEntries(previousIndex.materials)) !== (await digestEntries(nextEntries))) {
      const nextIndex: VocalAudioBackupIndex = {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        materials: nextEntries,
      };
      await writeFile(audioDirectory, "index.json", JSON.stringify(nextIndex, null, 2));
    }
    return "backed-up";
  } catch {
    return "failed";
  }
}

export async function readVocalAudioLibrary(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<VocalAudioMaterial[] | undefined> {
  let audioDirectory: FileSystemDirectoryHandle;
  try {
    audioDirectory = await directoryHandle.getDirectoryHandle("audio");
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
    throw error;
  }
  const index = await readIndex(audioDirectory);
  if (!index) return undefined;
  const materials: VocalAudioMaterial[] = [];
  for (const entry of index.materials) {
    const audioBlob = await (await audioDirectory.getFileHandle(entry.audioFileName)).getFile();
    if (audioBlob.size !== entry.size || (await digestBlob(audioBlob)) !== entry.contentDigest) {
      throw new Error(`音频备份校验失败：${entry.name}`);
    }
    materials.push({
      schemaVersion: 1,
      id: entry.id,
      name: entry.name,
      source: entry.source,
      mimeType: entry.mimeType,
      size: entry.size,
      durationSeconds: entry.durationSeconds,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      contentDigest: entry.contentDigest,
      originalFileName: entry.originalFileName,
      config: entry.config,
      analysis: await readOptionalAnalysis(audioDirectory, entry.analysisFileName, entry.analysisDigest),
      audioBlob,
    });
  }
  return materials;
}

export async function restoreVocalAudioLibrary(directoryHandle: FileSystemDirectoryHandle): Promise<boolean> {
  const materials = await readVocalAudioLibrary(directoryHandle);
  if (!materials) return false;
  await replaceVocalAudioMaterials(materials);
  return true;
}
