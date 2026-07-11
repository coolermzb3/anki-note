# UI 手调位置速查

所有谱表调参集中在 [`staffLayoutProfiles.ts`](../src/components/staffLayoutProfiles.ts)，并按页面分成五个 profile。共有接口提供中文字段说明和 `satisfies` 结构检查；页面特有参数在对应 profile 内单独注释。学习页、默写页、统计页、练习单音和谱页共用 [`staffGeometry.ts`](../src/components/staffGeometry.ts) 的坐标换算、谱表与连接线创建、谱表锚点和音符区域算法。

代码分层如下：

- `staffLayoutProfiles.ts`：只放可手调的最终显示尺寸，字段统一使用 `Px` 后缀；共有部分为 `notationScale`、`horizontal` 和 `vertical`。
- `staffGeometry.ts`：只放各页面复用的几何和基础谱表算法。
- 各页面组件：保留该页面独有的音符分层、颜色、Label、热点、状态、符干、时值和谱页分行逻辑。

谱面缩放遵循以下规则：

- `notationScale` / `scale` 只做显式放大，取值至少为 `1`，布局不会按容器自动缩小谱面。
- 页面布局常量以最终显示像素为单位；进入 VexFlow 逻辑坐标时使用 `logicalPx(displayPx, scale)` 换算。Label 等无需随谱面放大的尺寸也按此方式保持屏幕尺寸不变。
- 纵向位置和高度完全由 `vertical` 固定：大谱表使用 `centerYPx` 与 `gapPx` / `ledgerGapPx`，未来单谱号模式使用 `trebleOnlyYPx` / `bassOnlyYPx`，viewport 使用 `viewHeightPx`。渲染不会测量音符边界、移动锚点或增加高度。
- 两行 Label 使用固定的 `noteNameYPx` 与 `lineGapPx`；第二行是固定调数字唱名，始终 `1=C`、`4=F`，不随调号变化。
- 谱页的 `multirow.rows × multirow.notesPerRow` 决定每页最大题量，当前为两行、每行 24 音，共 48 音；最后一页只画实际题量，不会为了凑满视觉分组而增加题目。每行固定占用 `vertical.viewHeightPx`，行间额外空白为 `multirow.rowGapPx`。SVG 高度为 `实际行数 × viewHeightPx + (实际行数 - 1) × rowGapPx`，第 N 行从 `(viewHeightPx + rowGapPx) × 行索引` 开始。
- 谱页先按标准位置把八分音符每 2 音、十六分音符每 4 音切组，再在每组内按谱表切成连续 run；至少两个同谱表音符即可由 VexFlow 连梁，单个音保留独立符尾。连梁不跨标准组、谱表切换或小节线，线条保持中性色，音符自身仍按答题状态着色。全音符和四分音符每 4 音画一条小节线，八分音符和十六分音符每 8 音画一条小节线；小节线按前后可见音符的实际边界放在空隙中点，没有安全空隙时省略，避免穿过符尾。

| 页面 / 区域 | 主要调整内容 | 代码入口 |
| --- | --- | --- |
| 共用谱表几何 | 缩放坐标、谱表外框、谱号后音符区域和均匀列中心 | [`staffGeometry.ts`](../src/components/staffGeometry.ts) |
| 学习页音位图 | 谱表左右留白、列距、高低谱表间距、Label 位置与字号 | [`STUDY_STAFF_LAYOUT`](../src/components/staffLayoutProfiles.ts) |
| 学习页与默写页谱表外框 | 卡片上留白、边框、背景与裁切 | [`.study-figure`](../src/styles.css) |
| 默写页大谱表 | 显式缩放与固定高度、横向压缩、谱表中点与间距、Label、列底状态和按谱线间距计算的命中范围 | [`STAFF_RECALL_LAYOUT`](../src/components/staffLayoutProfiles.ts) |
| 默写页谱表样式 | 加线、列底文字、遮罩和当前列高亮 | [`.staff-recall-*`](../src/styles.css) |
| 默写完成区 | 结果面板与趋势图尺寸、间距和线条 | [`.staff-recall-summary` / `.staff-recall-trend-*`](../src/styles.css) |
| 练习页单音谱表 | 固定高度、谱表宽度、高低音谱表位置和内容留白 | [`PRACTICE_SINGLE_STAFF_LAYOUT`](../src/components/staffLayoutProfiles.ts) |
| 练习页单音区域 | 舞台高度、谱表容器尺寸与阴影 | [`.prompt-stage` / `.staff`](../src/styles.css) |
| 练习页谱页 | 最大行数、每行音符数、单行固定高度、时值分组、连梁和小节线 | [`PRACTICE_PAGE_STAFF_LAYOUT`](../src/components/staffLayoutProfiles.ts)、[`staffPageNotation.ts`](../src/components/staffPageNotation.ts) |
| 练习页多音区域 | 页面谱表舞台和容器尺寸 | [`.staff-page-stage`](../src/styles.css) |
| 统计页音域谱表 | 列距、谱表留白、Label 位置与字号 | [`STATS_RANGE_STAFF_LAYOUT`](../src/components/staffLayoutProfiles.ts) |
| 统计页颜色 | 热力图、音域着色和识别曲线配色 | [`STATS_COLORS`](../src/components/statsColors.ts) |
