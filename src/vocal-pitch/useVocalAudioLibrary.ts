import { useCallback, useEffect, useRef, useState } from "react";
import { writeBackupIfSafe } from "../data/backup";
import { digestBlob } from "../data/blobDigest";
import { deleteVocalAudioMaterial, listVocalAudioMaterials, saveVocalAudioMaterial } from "../data/db";
import { getVocalAudioBackupStatus, type VocalAudioBackupStatus } from "../data/vocalAudioBackup";
import type { VocalAudioMaterial } from "../domain/vocalPitch";
import { createSerialTaskQueue, type SerialTaskQueue } from "../serialTaskQueue";
import { decodeAudioBlob } from "./pitchAnalysis";
import { encodeMonoWavPcm16 } from "./wavEncode";

interface UseVocalAudioLibraryOptions {
  backupDirectory?: FileSystemDirectoryHandle;
  libraryRevision?: string;
  onBackupStateChanged: () => void | Promise<void>;
  onMessage: (message: string) => void;
}

export function useVocalAudioLibrary({
  backupDirectory,
  libraryRevision,
  onBackupStateChanged,
  onMessage,
}: UseVocalAudioLibraryOptions) {
  const [materials, setMaterials] = useState<VocalAudioMaterial[]>([]);
  const [backupStatus, setBackupStatus] = useState<VocalAudioBackupStatus>(backupDirectory ? "out-of-sync" : "browser-only");
  const mountedRef = useRef(false);
  const mutationQueueRef = useRef<SerialTaskQueue | null>(null);
  mutationQueueRef.current ??= createSerialTaskQueue();
  const enqueueMutation = mutationQueueRef.current;

  const refresh = useCallback(async (): Promise<VocalAudioMaterial[]> => {
    const nextMaterials = await listVocalAudioMaterials();
    if (mountedRef.current) setMaterials(nextMaterials);
    return nextMaterials;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [libraryRevision, refresh]);

  useEffect(() => {
    let cancelled = false;
    void getVocalAudioBackupStatus(backupDirectory).then((status) => {
      if (!cancelled) setBackupStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [backupDirectory, libraryRevision, materials.length]);

  const sync = useCallback(async () => {
    await writeBackupIfSafe();
    await Promise.resolve(onBackupStateChanged()).catch(() => undefined);
    const status = await getVocalAudioBackupStatus(backupDirectory);
    if (mountedRef.current) {
      setBackupStatus(status);
      if (status === "failed") onMessage("素材已保存到浏览器，但备份失败");
      if (status === "browser-only") onMessage("素材已保存到浏览器，尚未备份");
      if (status === "out-of-sync") onMessage("素材已保存到浏览器；备份数据不一致，请先选择保留哪一份");
    }
  }, [backupDirectory, onBackupStateChanged, onMessage]);

  const saveLocal = useCallback((material: VocalAudioMaterial): Promise<void> =>
    enqueueMutation(async () => {
      await saveVocalAudioMaterial(material);
      await refresh();
    }), [enqueueMutation, refresh]);

  const syncBackup = sync;

  const save = useCallback(async (material: VocalAudioMaterial): Promise<void> => {
    await saveLocal(material);
    await sync();
  }, [saveLocal, sync]);

  const migrateVideoMaterials = useCallback(async (): Promise<void> => {
    const failed = await enqueueMutation(async (): Promise<number | null> => {
      const videos = (await listVocalAudioMaterials()).filter((material) => material.mimeType.startsWith("video/"));
      if (videos.length === 0) return null;
      let failed = 0;
      for (const material of videos) {
        try {
          const decoded = await decodeAudioBlob(material.audioBlob);
          const audioBlob = encodeMonoWavPcm16(decoded.samples, decoded.sampleRate);
          await saveVocalAudioMaterial({
            ...material,
            audioBlob,
            mimeType: audioBlob.type,
            size: audioBlob.size,
            contentDigest: await digestBlob(audioBlob),
            updatedAt: new Date().toISOString(),
          });
        } catch {
          failed += 1;
        }
      }
      await refresh();
      return failed;
    });
    if (failed === null) return;
    await sync();
    if (failed > 0) onMessage(`${failed} 个视频素材转换为音频失败，仍保留原始文件`);
  }, [enqueueMutation, onMessage, refresh, sync]);

  useEffect(() => {
    void migrateVideoMaterials().catch(() => undefined);
  }, [migrateVideoMaterials]);

  const rename = useCallback(async (material: VocalAudioMaterial, name: string): Promise<VocalAudioMaterial> => {
    const updated = { ...material, name, updatedAt: new Date().toISOString() };
    await save(updated);
    return updated;
  }, [save]);

  const remove = useCallback(async (id: string): Promise<void> => {
    await enqueueMutation(async () => {
      await deleteVocalAudioMaterial(id);
      await refresh();
    });
    await sync();
  }, [enqueueMutation, refresh, sync]);

  return { backupStatus, materials, refresh, remove, rename, save, saveLocal, syncBackup };
}
