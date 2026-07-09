# UI 手调位置速查

常用视觉参数集中在下列常量与 CSS 区域。调整时优先从对应入口开始，避免在渲染流程中散改数值。

| 页面 / 区域 | 主要调整内容 | 代码入口 |
| --- | --- | --- |
| 学习页音位图 | 谱表左右留白、列距、高低谱表间距、Label 位置与字号 | [`STUDY_MAP_LAYOUT`](../src/components/StudyView.tsx) |
| 学习页与默写页谱表外框 | 卡片上留白、边框、背景与裁切 | [`.study-figure`](../src/styles.css) |
| 默写页大谱表 | 整体缩放与高度、横向压缩、谱表中点与间距、Label、列底状态和命中范围 | [`RECALL_MAP_LAYOUT`](../src/components/StaffRecallMap.tsx) |
| 默写页谱表样式 | 加线、列底文字、遮罩和当前列高亮 | [`.staff-recall-*`](../src/styles.css) |
| 默写完成区 | 结果面板与趋势图尺寸、间距和线条 | [`.staff-recall-summary` / `.staff-recall-trend-*`](../src/styles.css) |
| 练习页单音谱表 | 画布宽高、谱表宽度与高低音谱表位置 | [`StaffPrompt` 渲染参数](../src/components/StaffPrompt.tsx) |
| 练习页单音区域 | 舞台高度、谱表容器尺寸与阴影 | [`.prompt-stage` / `.staff`](../src/styles.css) |
| 练习页多音谱表 | 每行音符数、行高、底部留白 | [`StaffPagePrompt` 顶部常量](../src/components/StaffPagePrompt.tsx) |
| 练习页多音区域 | 页面谱表舞台和容器尺寸 | [`.staff-page-stage`](../src/styles.css) |
| 统计页音域谱表 | 列距、谱表留白、Label 位置与字号 | [`RANGE_MAP_LAYOUT`](../src/components/StatsRangeStaff.tsx) |
| 统计页颜色 | 热力图、音域着色和识别曲线配色 | [`STATS_COLORS`](../src/components/statsColors.ts) |
