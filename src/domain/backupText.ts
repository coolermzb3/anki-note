import type { BackupState } from "./types";
import type { VocalAudioCounts } from "./vocalPitch";

export const backupText = {
  labels: {
    applyDomainChoices: "应用选择并合并",
    backupDirectory: "备份目录",
    browser: "当前浏览器",
    chooseDirectory: "选择目录",
    chooseEmptyDirectory: "选择空目录",
    close: "关闭",
    importBackup: "导入备份",
    learningDomain: "学习域",
    dismiss: "稍后",
    suppressToday: "今日不再提醒",
    vocalAudioDomain: "清唱素材域",
  },
  titles: {
    chooseDirectorySuggestion: "建议设置备份目录",
    conflictResolved: "备份冲突已解决",
    dataConflict: "请选择各数据域保留哪边",
    importSuccess: "已导入备份",
  },
  messages: {
    backupDirectoryAutoImported: "备份目录已有更新，已按数据域自动同步。",
    backupEnabled: "自动备份已启用；学习记录和已保存的清唱素材会写入备份目录。",
    backupPermissionOrDirectoryHint: "请检查备份目录权限，或在设置页重新选择目录。",
    browserDataWillBeReplaced: "导入备份会替换当前浏览器内的学习数据和清唱素材。继续？",
    browserOnlyNeedsDirectory: "学习记录只保存在当前浏览器，设置目录后可以导入和迁移数据。",
    directorySelected: "已选择备份目录",
    emptyBackupDirectory: "备份目录还没有可导入的数据；产生学习记录或保存清唱素材后会自动备份。",
    dataConflictBeforeBackup:
      "备份目录与当前浏览器在部分数据域中都发生了变化。请分别选择这些数据域保留哪一边；未冲突的数据域会自动合并。也可以改选空目录以保留两边。",
    conflictChanged: "冲突期间数据已发生变化，请根据刷新后的信息重新选择。",
    domainConflictHint: "学习域包含练习、默写与设置；清唱素材域包含录音、上传文件及分析缓存。",
    conflictResolvedDetail: "已按选择合并浏览器与备份目录数据。",
    importSuccessDetail: "当前浏览器已使用备份目录中的数据。",
  },
  status: {
    normal: "正常",
    unsupportedFileSystemAccess: "当前浏览器不支持 File System Access。",
    unselected: "未选择",
  },
  errors: {
    dayFileDigestMismatch: "备份文件与清单不一致，请稍后重试或检查备份目录。",
    permissionExpired: "备份目录权限已失效。",
    readPermissionDenied: "未获得备份目录读取权限。",
    unsupportedDirectoryPicker: "当前浏览器不支持选择备份目录。",
    writePermissionDenied: "未获得备份目录写入权限。",
  },
} as const;

function formatBackupTime(value?: string): string {
  return value ? new Date(value).toLocaleString() : "未知";
}

export interface BackupConflictDataSummary {
  firstDataAt: string;
  lastDataAt: string;
  recordCount: number;
  vocalAudioCounts: VocalAudioCounts;
}

export interface BackupConflictDataSummaries {
  backup: BackupConflictDataSummary;
  browser: BackupConflictDataSummary;
}

type BackupConflictSummarySource = Pick<
  BackupState,
  | "conflictBackupFirstReviewAt"
  | "conflictBackupLastReviewAt"
  | "conflictBackupReviewCount"
  | "conflictBrowserFirstReviewAt"
  | "conflictBrowserLastReviewAt"
  | "conflictBrowserReviewCount"
  | "conflictBackupFirstDataAt"
  | "conflictBackupLastDataAt"
  | "conflictBackupRecordCount"
  | "conflictBrowserFirstDataAt"
  | "conflictBrowserLastDataAt"
  | "conflictBrowserRecordCount"
  | "conflictBrowserVocalAudioCounts"
  | "conflictBackupVocalAudioCounts"
>;

function formatBackupDataSummary(
  firstDataAt?: string,
  lastDataAt?: string,
  recordCount?: number,
  vocalAudioCounts: VocalAudioCounts = { materialCount: 0, recordingCount: 0, uploadCount: 0 },
): BackupConflictDataSummary {
  return {
    firstDataAt: formatBackupTime(firstDataAt),
    lastDataAt: formatBackupTime(lastDataAt),
    recordCount: recordCount ?? 0,
    vocalAudioCounts,
  };
}

export function getBackupConflictDataSummaries(
  backupState: BackupConflictSummarySource,
): BackupConflictDataSummaries {
  const backup = formatBackupDataSummary(
    backupState.conflictBackupFirstDataAt ?? backupState.conflictBackupFirstReviewAt,
    backupState.conflictBackupLastDataAt ?? backupState.conflictBackupLastReviewAt,
    backupState.conflictBackupRecordCount ?? backupState.conflictBackupReviewCount,
    backupState.conflictBackupVocalAudioCounts,
  );
  const browser = formatBackupDataSummary(
    backupState.conflictBrowserFirstDataAt ?? backupState.conflictBrowserFirstReviewAt,
    backupState.conflictBrowserLastDataAt ?? backupState.conflictBrowserLastReviewAt,
    backupState.conflictBrowserRecordCount ?? backupState.conflictBrowserReviewCount,
    backupState.conflictBrowserVocalAudioCounts,
  );
  return { backup, browser };
}

export function formatBackupConflictDetail(
  _backupState: BackupState,
): string {
  return backupText.messages.dataConflictBeforeBackup;
}
