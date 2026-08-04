# 未来方向

这里记录已经明确讨论、但尚无近期实现承诺的方向。当前行为和兼容规则仍以各主题的正式文档与 ADR 为准。

文件名前缀是该方向首次写入仓库的日期，只用于追溯背景，不代表优先级或计划完成时间。

- [分面识别进度图](2026-07-12-faceted-session-progress-charts.md)：叠加曲线难以阅读时，评估改用分面小图。
- [历史目标集合导航](2026-07-12-historical-target-set-navigation.md)：按既有练习目标集合回看统计数据。
- [练习模式证据校准](2026-07-14-practice-mode-evidence.md)：先用真实数据判断不同练习模式能否共享识别速度证据。
- [移调乐器档案](2026-07-11-transposing-instruments.md)：分离书写音高、实际发声音高与音色。
- [共享谱表渲染适配器](2026-07-15-shared-staff-rendering-adapter.md)：在共同生命周期稳定后减少 VexFlow 重复代码。
- [练习会话运行时](2026-07-15-practice-session-runtime.md)：把会话状态转换与 React 展示分离。
- [领域模块组织](2026-07-15-domain-module-organization.md)：只为已经形成稳定簇的领域代码建立子目录。
- [单写入者备份与开发数据隔离](2026-08-04-single-writer-backup-and-dev-data.md)：把正式备份收缩为单向镜像，并为 dev/preview 提供独立的可写目录和可记忆的正式只读来源。
