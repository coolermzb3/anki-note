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
    backupEnabled: "自动备份已启用，练习结束后会写入备份目录。",
    backupPermissionOrDirectoryHint: "请检查备份目录权限，或在设置页重新选择目录。",
    browserDataWillBeReplaced: "导入备份会替换当前浏览器内练习数据。继续？",
    browserOnlyNeedsDirectory: "练习记录只保存在当前浏览器，设置目录后可以导入和迁移数据。",
    directorySelected: "已选择备份目录",
    emptyBackupDirectory: "备份目录还没有可导入的数据，先练习一次后会自动备份。",
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
  firstReviewAt: string;
  lastReviewAt: string;
  reviewCount: number;
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
>;

function formatBackupDataSummary(
  firstReviewAt?: string,
  lastReviewAt?: string,
  reviewCount?: number,
): BackupConflictDataSummary {
  return {
    firstReviewAt: formatBackupTime(firstReviewAt),
    lastReviewAt: formatBackupTime(lastReviewAt),
    reviewCount: reviewCount ?? 0,
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
  firstReviewAt,
  lastReviewAt,
  reviewCount,
  otherFirstReviewAt,
  otherLastReviewAt,
  otherReviewCount,
}: {
  firstReviewAt?: string;
  lastReviewAt?: string;
  otherFirstReviewAt?: string;
  otherLastReviewAt?: string;
  otherReviewCount?: number;
  reviewCount?: number;
}): boolean {
  if (!firstReviewAt || !lastReviewAt || !otherFirstReviewAt || !otherLastReviewAt) {
    return false;
  }
  return (
    compareBackupTime(firstReviewAt, otherFirstReviewAt) <= 0 &&
    compareBackupTime(lastReviewAt, otherLastReviewAt) >= 0 &&
    (reviewCount ?? 0) >= (otherReviewCount ?? 0)
  );
}

export function getBackupConflictDataSummaries(
  backupState: BackupConflictSummarySource,
): BackupConflictDataSummaries {
  const backup = formatBackupDataSummary(
    backupState.conflictBackupFirstReviewAt,
    backupState.conflictBackupLastReviewAt,
    backupState.conflictBackupReviewCount,
  );
  const browser = formatBackupDataSummary(
    backupState.conflictBrowserFirstReviewAt,
    backupState.conflictBrowserLastReviewAt,
    backupState.conflictBrowserReviewCount,
  );
  const backupCoversBrowser = backupDataCovers({
    firstReviewAt: backupState.conflictBackupFirstReviewAt,
    lastReviewAt: backupState.conflictBackupLastReviewAt,
    otherFirstReviewAt: backupState.conflictBrowserFirstReviewAt,
    otherLastReviewAt: backupState.conflictBrowserLastReviewAt,
    otherReviewCount: backupState.conflictBrowserReviewCount,
    reviewCount: backupState.conflictBackupReviewCount,
  });
  const browserCoversBackup = backupDataCovers({
    firstReviewAt: backupState.conflictBrowserFirstReviewAt,
    lastReviewAt: backupState.conflictBrowserLastReviewAt,
    otherFirstReviewAt: backupState.conflictBackupFirstReviewAt,
    otherLastReviewAt: backupState.conflictBackupLastReviewAt,
    otherReviewCount: backupState.conflictBackupReviewCount,
    reviewCount: backupState.conflictBrowserReviewCount,
  });
  return {
    backup,
    browser,
    highlighted: backupCoversBrowser === browserCoversBackup ? null : backupCoversBrowser ? "backup" : "browser",
  };
}

export function formatBackupConflictDetail(
  _backupState: Pick<
    BackupState,
    | "conflictBackupFirstReviewAt"
    | "conflictBackupLastReviewAt"
    | "conflictBackupReviewCount"
    | "conflictBrowserFirstReviewAt"
    | "conflictBrowserLastReviewAt"
    | "conflictBrowserReviewCount"
  >,
): string {
  return backupText.messages.dataConflictBeforeBackup;
}
