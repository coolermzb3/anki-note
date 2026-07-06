export const backupText = {
  labels: {
    chooseDirectory: "选择目录",
    close: "关闭",
    importBackup: "导入备份",
    dismiss: "稍后",
    suppressToday: "今日不再提醒",
  },
  titles: {
    chooseDirectorySuggestion: "建议设置备份目录",
    importRequired: "请先导入备份",
    importSuccess: "已导入备份",
  },
  messages: {
    backupDirectoryChanged: "备份目录已有更新，请先导入备份。",
    backupEnabled: "自动备份已启用，练习结束后会写入备份目录。",
    backupPermissionOrDirectoryHint: "请检查备份目录权限，或在设置页重新选择目录。",
    browserDataWillBeReplaced: "导入备份会替换当前浏览器内练习数据。继续？",
    browserOnlyNeedsDirectory: "练习记录只保存在当前浏览器，设置目录后可以导入和迁移数据。",
    directorySelected: "已选择备份目录",
    emptyBackupDirectory: "备份目录还没有可导入的数据，先练习一次后会自动备份。",
    importRequiredBeforeBackup:
      "当前备份目录已有备份数据，请先导入；否则继续练习产生的新数据不会写入备份，且会在导入备份时丢失。",
    importSuccessDetail: "当前浏览器已使用备份目录中的数据。",
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
