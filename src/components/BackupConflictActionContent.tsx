import type { ReactNode } from "react";
import { backupText, type BackupConflictDataSummary } from "../domain/backupText";

interface BackupConflictActionContentProps {
  icon: ReactNode;
  label: string;
  summary: BackupConflictDataSummary;
}

export function BackupConflictActionContent({
  icon,
  label,
  summary,
}: BackupConflictActionContentProps): JSX.Element {
  const { materialCount, recordingCount, uploadCount } = summary.vocalAudioCounts;
  return (
    <>
      <span className="backup-action-heading">
        {icon}
        <span>{label}</span>
      </span>
      <span className="backup-action-summary">
        <span>
          {backupText.labels.conflictStart}：{summary.firstDataAt}
        </span>
        <span>
          {backupText.labels.conflictEnd}：{summary.lastDataAt}
        </span>
        <span>
          {backupText.labels.conflictCount}：{summary.recordCount} 条
        </span>
        <span>
          {backupText.labels.conflictVocalAudio}：{materialCount} 个（录音 {recordingCount}，上传 {uploadCount}）
        </span>
      </span>
    </>
  );
}
