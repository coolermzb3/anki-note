import type { BackupState } from "./types";

export const backupText = {
  labels: {
    chooseDirectory: "选择目录",
    chooseEmptyDirectory: "选择空目录",
    close: "关闭",
    importBackup: "导入备份",
    keepBackupData: "保留备份目录数据",
    keepBrowserData: "保留浏览器数据",
    dismiss: "稍后",
    suppressToday: "今日不再提醒",
  },
  titles: {
    backupWritten: "已写入备份",
    chooseDirectorySuggestion: "建议设置备份目录",
    dataConflict: "请选择保留哪份数据",
    importSuccess: "已导入备份",
  },
  messages: {
    backupDirectoryAutoImported: "备份目录已有更新，已自动导入。",
    backupDirectoryWillBeReplaced: "这会用当前浏览器数据覆盖备份目录。继续？",
    backupEnabled: "自动备份已启用，练习结束后会写入备份目录。",
    backupPermissionOrDirectoryHint: "请检查备份目录权限，或在设置页重新选择目录。",
    browserDataWillBeReplaced: "导入备份会替换当前浏览器内练习数据。继续？",
    browserOnlyNeedsDirectory: "练习记录只保存在当前浏览器，设置目录后可以导入和迁移数据。",
    directorySelected: "已选择备份目录",
    emptyBackupDirectory: "备份目录还没有可导入的数据，先练习一次后会自动备份。",
    dataConflictBeforeBackup: "备份目录与当前浏览器数据不一致。请选择保留哪份数据，或改选空目录以保留两边。",
    importSuccessDetail: "当前浏览器已使用备份目录中的数据。",
    browserDataWrittenToBackup: "已用当前浏览器数据写入备份目录。",
  },
  status: {
    normal: "正常",
    unsupportedFileSystemAccess: "当前浏览器不支持 File System Access。",
    unselected: "未选择",
  },
  errors: {
    permissionExpired: "备份目录权限已失效。",
    readPermissionDenied: "未获得备份目录读取权限。",
    unsupportedDirectoryPicker: "当前浏览器不支持选择备份目录。",
    writePermissionDenied: "未获得备份目录写入权限。",
  },
} as const;

function formatBackupTime(value?: string): string {
  return value ? new Date(value).toLocaleString() : "未知";
}

function formatBackupDataSummary(label: string, firstReviewAt?: string, lastReviewAt?: string, reviewCount?: number): string {
  const range =
    firstReviewAt || lastReviewAt
      ? `${formatBackupTime(firstReviewAt)} - ${formatBackupTime(lastReviewAt)}`
      : "无";
  return `${label}：起止 ${range}，条数 ${reviewCount ?? 0}`;
}

export function formatBackupConflictDetail(
  backupState: Pick<
    BackupState,
    | "conflictBackupFirstReviewAt"
    | "conflictBackupLastReviewAt"
    | "conflictBackupReviewCount"
    | "conflictBrowserFirstReviewAt"
    | "conflictBrowserLastReviewAt"
    | "conflictBrowserReviewCount"
  >,
): string {
  if (
    backupState.conflictBrowserReviewCount === undefined &&
    backupState.conflictBackupReviewCount === undefined
  ) {
    return backupText.messages.dataConflictBeforeBackup;
  }
  const browserSummary = formatBackupDataSummary(
    "浏览器数据",
    backupState.conflictBrowserFirstReviewAt,
    backupState.conflictBrowserLastReviewAt,
    backupState.conflictBrowserReviewCount,
  );
  const backupSummary = formatBackupDataSummary(
    "备份目录数据",
    backupState.conflictBackupFirstReviewAt,
    backupState.conflictBackupLastReviewAt,
    backupState.conflictBackupReviewCount,
  );
  return `${backupText.messages.dataConflictBeforeBackup} ${browserSummary}；${backupSummary}。`;
}
