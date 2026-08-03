import { useCallback, useEffect, useState } from "react";
import { writeBackupIfSafe } from "../data/backup";
import { deleteVocalAudioMaterial, listVocalAudioMaterials, saveVocalAudioMaterial } from "../data/db";
import { getVocalAudioBackupStatus, type VocalAudioBackupStatus } from "../data/vocalAudioBackup";
import type { VocalAudioMaterial } from "../domain/vocalPitch";

interface UseVocalAudioLibraryOptions {
  backupDirectory?: FileSystemDirectoryHandle;
  onBackupStateChanged: () => void | Promise<void>;
  onMessage: (message: string) => void;
}

export function useVocalAudioLibrary({
  backupDirectory,
  onBackupStateChanged,
  onMessage,
}: UseVocalAudioLibraryOptions) {
  const [materials, setMaterials] = useState<VocalAudioMaterial[]>([]);
  const [backupStatus, setBackupStatus] = useState<VocalAudioBackupStatus>(backupDirectory ? "out-of-sync" : "browser-only");

  const refresh = useCallback(async () => {
    setMaterials(await listVocalAudioMaterials());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void getVocalAudioBackupStatus(backupDirectory).then((status) => {
      if (!cancelled) setBackupStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [backupDirectory, materials.length]);

  const sync = useCallback(async () => {
    await writeBackupIfSafe();
    await Promise.resolve(onBackupStateChanged()).catch(() => undefined);
    const status = await getVocalAudioBackupStatus(backupDirectory);
    setBackupStatus(status);
    if (status === "failed") onMessage("素材已保存到浏览器，但备份失败");
    if (status === "browser-only") onMessage("素材已保存到浏览器，尚未备份");
    if (status === "out-of-sync") onMessage("素材已保存到浏览器；备份数据不一致，请先选择保留哪一份");
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
