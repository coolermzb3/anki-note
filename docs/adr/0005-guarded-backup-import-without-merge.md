# Guarded backup import without merge

Backup directories are guarded snapshots, not two-way merge stores. The app derives one backup state from browser data, selected directory data, and their snapshot consistency, then applies the action table below at each check timing.

`down` means writing the current browser data into the selected backup directory. `up` means importing the selected backup directory into the browser and replacing browser data. The app does not merge sessions, reviews, or settings.

In the action table, `append` means the just-finished practice data remains in the browser data store after the check. During practice and after session settlement, backup writes are down-only: they may write the current browser data into the selected directory, but they must not import directory data over the current browser data. If a down-only write detects divergence, the app records `data-conflict` and shows the three-way choice after settlement. Under the normal flow, detecting divergence only after practice should not happen because the start preflight already checked the directory; it indicates the backup directory changed while the session was running.

`dataModifiedAt` is the user-facing data freshness timestamp. It is derived from the latest session/review/settings data included in a snapshot. `lastBackupAt` is only the write time of the backup snapshot and is kept for compatibility and debugging.

When the app detects `数据不一致` immediately after directory selection, it stores an explicit `data-conflict` guard. Practice-page checks and practice-finished backup attempts must not silently `up` or `down` while this guard exists. The guard is cleared only when the learner keeps backup-directory data, writes browser data to the selected backup directory, or chooses a directory that can be brought to `正常`.

## 数据对应状态及解释

| 浏览器有数据 | 已选目录 | 目录有数据 | 数据一致性 | 状态           | 解释                                     |
| ------------ | -------- | ---------- | ---------- | -------------- | ---------------------------------------- |
| -            | 0        | /          | /          | 等待选目录     | 新用户一直没选                           |
| 0            | 1        | 0          | /          | 正常           | 新用户选了空目录                         |
| 1            | 1        | 0          | /          | 浏览器有本地无 | 练完才选空目录；练习前手动删除了本地内容 |
| 0            | 1        | 1          | /          | 浏览器无本地有 | 刚换浏览器；练习前清理浏览器数据         |
| 1            | 1        | 1          | 1          | 正常           | 浏览器有数据且与目录数据一致             |
| 1            | 1        | 1          | 0          | 数据不一致     | 刚反复切换数据目录；Pages/dev 练习前切换 |

## 状态-检查时动作

| 状态           | 刚选完目录时                                                                     | 练习前检查（切到练习页）                                                    | 练习后                                         |
| -------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| 等待选目录     | 绝不出现（没选呢）                                                               | 显式提醒：建议选目录                                                        | append                                         |
| 正常           | 无                                                                               | 无                                                                          | append + down                                  |
| 浏览器有本地无 | 静默 down，之后状态转为正常                                                      | 静默 down，之后状态转为正常                                                 | 不该出现；fallback append + down               |
| 浏览器无本地有 | 静默 up，之后状态转为正常                                                        | 静默 up，之后状态转为正常                                                   | 不该出现；进入 data-conflict，结算后提醒三选一 |
| 数据不一致     | 显式提醒并保留持久冲突标志：改选空目录保留两边；保留备份目录数据；保留浏览器数据 | 若无持久冲突标志，则目录数据较新时静默 up；否则显式提醒并进入 data-conflict | 不该出现；进入 data-conflict，结算后提醒三选一 |
