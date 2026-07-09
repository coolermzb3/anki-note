import type { BackupState } from "./types";

export const backupText = {
  labels: {
    chooseDirectory: "选择目录",
    chooseEmptyDirectory: "选择空目录",
    close: "关闭",
    conflictCount: "条数",
    conflictEnd: "截止",
    conflictStart: "起始",
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
    backupEnabled: "自动备份已启用，练习或默写完成后会写入备份目录。",
    backupPermissionOrDirectoryHint: "请检查备份目录权限，或在设置页重新选择目录。",
    browserDataWillBeReplaced: "导入备份会替换当前浏览器内学习数据。继续？",
    browserOnlyNeedsDirectory: "学习记录只保存在当前浏览器，设置目录后可以导入和迁移数据。",
    directorySelected: "已选择备份目录",
    emptyBackupDirectory: "备份目录还没有可导入的数据，完成一次练习或默写后会自动备份。",
    dataConflictBeforeBackup:
      "备份目录与当前浏览器数据不一致。请选择保留哪份数据，或改选空目录以保留两边（备份目录数据保留，浏览器数据进入新的空目录）。",
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

export interface BackupConflictDataSummary {
  firstDataAt: string;
  lastDataAt: string;
  recordCount: number;
}

export interface BackupConflictDataSummaries {
  backup: BackupConflictDataSummary;
  browser: BackupConflictDataSummary;
  highlighted: "backup" | "browser" | null;
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
  | "conflictBackupStaffRecallRunCount"
  | "conflictBrowserFirstDataAt"
  | "conflictBrowserLastDataAt"
  | "conflictBrowserRecordCount"
  | "conflictBrowserStaffRecallRunCount"
>;

function formatBackupDataSummary(
  firstDataAt?: string,
  lastDataAt?: string,
  recordCount?: number,
): BackupConflictDataSummary {
  return {
    firstDataAt: formatBackupTime(firstDataAt),
    lastDataAt: formatBackupTime(lastDataAt),
    recordCount: recordCount ?? 0,
  };
}

function compareBackupTime(a?: string, b?: string): number {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return -1;
  }
  if (!b) {
    return 1;
  }
  const parsedA = Date.parse(a);
  const parsedB = Date.parse(b);
  if (Number.isFinite(parsedA) && Number.isFinite(parsedB)) {
    return parsedA - parsedB;
  }
  return a.localeCompare(b);
}

function backupDataCovers({
  firstDataAt,
  lastDataAt,
  reviewCount,
  staffRecallRunCount,
  otherFirstDataAt,
  otherLastDataAt,
  otherReviewCount,
  otherStaffRecallRunCount,
}: {
  firstDataAt?: string;
  lastDataAt?: string;
  otherFirstDataAt?: string;
  otherLastDataAt?: string;
  otherReviewCount?: number;
  otherStaffRecallRunCount?: number;
  reviewCount?: number;
  staffRecallRunCount?: number;
}): boolean {
  if (
    !firstDataAt ||
    !lastDataAt ||
    !otherFirstDataAt ||
    !otherLastDataAt ||
    reviewCount === undefined ||
    otherReviewCount === undefined ||
    staffRecallRunCount === undefined ||
    otherStaffRecallRunCount === undefined
  ) {
    return false;
  }
  return (
    compareBackupTime(firstDataAt, otherFirstDataAt) <= 0 &&
    compareBackupTime(lastDataAt, otherLastDataAt) >= 0 &&
    reviewCount >= otherReviewCount &&
    staffRecallRunCount >= otherStaffRecallRunCount
  );
}

export function getBackupConflictDataSummaries(
  backupState: BackupConflictSummarySource,
): BackupConflictDataSummaries {
  const backup = formatBackupDataSummary(
    backupState.conflictBackupFirstDataAt ?? backupState.conflictBackupFirstReviewAt,
    backupState.conflictBackupLastDataAt ?? backupState.conflictBackupLastReviewAt,
    backupState.conflictBackupRecordCount ?? backupState.conflictBackupReviewCount,
  );
  const browser = formatBackupDataSummary(
    backupState.conflictBrowserFirstDataAt ?? backupState.conflictBrowserFirstReviewAt,
    backupState.conflictBrowserLastDataAt ?? backupState.conflictBrowserLastReviewAt,
    backupState.conflictBrowserRecordCount ?? backupState.conflictBrowserReviewCount,
  );
  const backupFirstDataAt = backupState.conflictBackupFirstDataAt ?? backupState.conflictBackupFirstReviewAt;
  const backupLastDataAt = backupState.conflictBackupLastDataAt ?? backupState.conflictBackupLastReviewAt;
  const browserFirstDataAt = backupState.conflictBrowserFirstDataAt ?? backupState.conflictBrowserFirstReviewAt;
  const browserLastDataAt = backupState.conflictBrowserLastDataAt ?? backupState.conflictBrowserLastReviewAt;
  const backupCoversBrowser = backupDataCovers({
    firstDataAt: backupFirstDataAt,
    lastDataAt: backupLastDataAt,
    otherFirstDataAt: browserFirstDataAt,
    otherLastDataAt: browserLastDataAt,
    otherReviewCount: backupState.conflictBrowserReviewCount,
    otherStaffRecallRunCount: backupState.conflictBrowserStaffRecallRunCount,
    reviewCount: backupState.conflictBackupReviewCount,
    staffRecallRunCount: backupState.conflictBackupStaffRecallRunCount,
  });
  const browserCoversBackup = backupDataCovers({
    firstDataAt: browserFirstDataAt,
    lastDataAt: browserLastDataAt,
    otherFirstDataAt: backupFirstDataAt,
    otherLastDataAt: backupLastDataAt,
    otherReviewCount: backupState.conflictBackupReviewCount,
    otherStaffRecallRunCount: backupState.conflictBackupStaffRecallRunCount,
    reviewCount: backupState.conflictBrowserReviewCount,
    staffRecallRunCount: backupState.conflictBrowserStaffRecallRunCount,
  });
  return {
    backup,
    browser,
    highlighted: backupCoversBrowser === browserCoversBackup ? null : backupCoversBrowser ? "backup" : "browser",
  };
}

export function formatBackupConflictDetail(
  _backupState: BackupState,
): string {
  return backupText.messages.dataConflictBeforeBackup;
}
