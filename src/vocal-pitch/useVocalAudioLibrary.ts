import { useCallback, useEffect, useRef, useState } from "react";
import { writeBackupIfSafe } from "../data/backup";
import { deleteVocalAudioMaterial, listVocalAudioMaterials, saveVocalAudioMaterial } from "../data/db";
import { getVocalAudioBackupStatus, type VocalAudioBackupStatus } from "../data/vocalAudioBackup";
import type { VocalAudioMaterial } from "../domain/vocalPitch";

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

  const save = useCallback(async (material: VocalAudioMaterial) => {
    await saveVocalAudioMaterial(material);
    await refresh();
    await sync();
  }, [refresh, sync]);

  const rename = useCallback(async (material: VocalAudioMaterial, name: string): Promise<VocalAudioMaterial> => {
    const updated = { ...material, name, updatedAt: new Date().toISOString() };
    await save(updated);
    return updated;
  }, [save]);

  const remove = useCallback(async (id: string) => {
    await deleteVocalAudioMaterial(id);
    await refresh();
    await sync();
  }, [refresh, sync]);

  return { backupStatus, materials, refresh, remove, rename, save };
}
