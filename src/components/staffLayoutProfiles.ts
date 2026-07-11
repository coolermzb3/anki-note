/** 所有谱表共有的横向手调参数，数值均为最终显示像素。 */
export interface StaffHorizontalProfile {
  /** 五线谱左右端到 SVG 边缘的目标留白；宽度不足时最先压缩。 */
  staffSidePaddingPx: number;
  /** 音符区域左右端到五线谱可写区域边缘的目标留白；宽度不足时第二步压缩。 */
  noteAreaSidePaddingPx: number;
  /** 音符区域左右留白压缩时不能低于此值。 */
  minNoteAreaSidePaddingPx: number;
}

/** 会随页面宽度压缩列距和外侧留白的谱表横向参数。 */
export interface ResponsiveStaffHorizontalProfile extends StaffHorizontalProfile {
  /** 谱号占宽的保守估计，只用于横向压缩判断，通常无需调整。 */
  clefReservePx: number;
  /** 相邻音名列中心的预期最大距离，只用于横向压缩判断。 */
  preferredColumnGapPx: number;
}

/** 所有谱表共有的固定纵向参数，渲染时不根据音符边界自动修改。 */
export interface StaffVerticalProfile {
  /** 大谱表上下两行锚点的中心。 */
  centerYPx: number;
  /** 普通大谱表中高低音谱表锚点的最终间距。 */
  gapPx: number;
  /** 启用“谱表间加线”时高低音谱表锚点的最终间距。 */
  ledgerGapPx: number;
  /** 未来单高音谱号模式直接传给 VexFlow Stave 的纵向锚点。 */
  trebleOnlyYPx: number;
  /** 未来单低音谱号模式直接传给 VexFlow Stave 的纵向锚点。 */
  bassOnlyYPx: number;
  /** 单套谱表固定占用的 viewport 高度；多行谱页按行组合。 */
  viewHeightPx: number;
}

/** 带两行音名标签的谱表共有参数。 */
export interface StaffLabelsProfile {
  /** 第一行固定调音名 C–B 的基线位置。 */
  noteNameYPx: number;
  /** 第一行与第二行基线之间的距离。 */
  lineGapPx: number;
  /** 第一行固定调音名字号。 */
  noteNameFontSizePx: number;
  /** 第二行固定调数字唱名字号；数字始终 1=C、4=F，不随调号变化。 */
  fixedDoNumberFontSizePx: number;
}

/** 所有谱表 profile 的共有接口；额外字段由各页面自行定义并注释。 */
export interface StaffLayoutProfile {
  /** VexFlow 谱面显式缩放；不会根据容器或音域自动缩放。 */
  notationScale: number;
  /** 横向布局参数。 */
  horizontal: StaffHorizontalProfile;
  /** 固定纵向布局参数。 */
  vertical: StaffVerticalProfile;
  [pageSpecificKey: string]: unknown;
}

/** 具有响应式列布局的谱表共有接口。 */
export interface ResponsiveStaffLayoutProfile extends StaffLayoutProfile {
  horizontal: ResponsiveStaffHorizontalProfile;
}

/** 具有响应式列布局和两行标签的谱表共有接口。 */
export interface ResponsiveLabeledStaffLayoutProfile extends ResponsiveStaffLayoutProfile {
  labels: StaffLabelsProfile;
}

// 学习页的“F1-G6 音符位置”大谱表。
export const STUDY_STAFF_LAYOUT = {
  notationScale: 1.5,
  horizontal: {
    clefReservePx: 72,
    preferredColumnGapPx: 76,
    staffSidePaddingPx: 200,
    noteAreaSidePaddingPx: 80,
    minNoteAreaSidePaddingPx: 40,
  },
  vertical: {
    centerYPx: 190,
    gapPx: 120,
    ledgerGapPx: 200,
    trebleOnlyYPx: 190,
    bassOnlyYPx: 190,
    viewHeightPx: 540,
  },
  labels: {
    // 使用启用“谱表间加线”时较高的现有位置，并固定不再随 gap 变化。
    noteNameYPx: 30,
    lineGapPx: 22,
    noteNameFontSizePx: 18,
    fixedDoNumberFontSizePx: 12,
  },
  // 两行 Label 点击热区在文字外额外扩展的距离。
  labelHitPaddingPx: 10,
  // 整列悬浮/播放高亮的尺寸。
  columnHighlight: {
    maxWidthPx: 74,
    spacingPaddingPx: 8,
    bottomPaddingPx: 60,
  },
  // 同列多个音依次播放时的间隔。
  columnNoteDelayMs: 0,
} as const satisfies ResponsiveLabeledStaffLayoutProfile;

// 统计页轮播卡片中的“音域分布”大谱表。
export const STATS_RANGE_STAFF_LAYOUT = {
  notationScale: 1,
  horizontal: {
    clefReservePx: 32,
    preferredColumnGapPx: 10,
    staffSidePaddingPx: 2,
    noteAreaSidePaddingPx: 18,
    minNoteAreaSidePaddingPx: 10,
  },
  vertical: {
    centerYPx: 125,
    gapPx: 130,
    ledgerGapPx: 130,
    trebleOnlyYPx: 125,
    bassOnlyYPx: 125,
    viewHeightPx: 320,
  },
  labels: {
    noteNameYPx: 18,
    lineGapPx: 15,
    noteNameFontSizePx: 13,
    fixedDoNumberFontSizePx: 11,
  },
} as const satisfies ResponsiveLabeledStaffLayoutProfile;

// 学习页“默写模式”的可点击大谱表。
export const STAFF_RECALL_LAYOUT = {
  notationScale: 2,
  horizontal: {
    clefReservePx: 144,
    preferredColumnGapPx: 72,
    staffSidePaddingPx: 100,
    noteAreaSidePaddingPx: 80,
    minNoteAreaSidePaddingPx: 36,
  },
  vertical: {
    centerYPx: 240,
    gapPx: 144,
    ledgerGapPx: 260,
    trebleOnlyYPx: 240,
    bassOnlyYPx: 240,
    viewHeightPx: 730,
  },
  labels: {
    noteNameYPx: 52,
    lineGapPx: 24,
    noteNameFontSizePx: 18,
    fixedDoNumberFontSizePx: 12,
  },
  // 每列底部三行计时状态；最后一行从 viewport 底部向上定位。
  status: {
    lineGapPx: 22,
    bottomLineOffsetPx: 30,
    fontSizePx: 17.334,
    labelFontSizePx: 16,
    valueFontSizePx: 20,
  },
  // 非当前列遮罩覆盖范围。
  overlay: {
    maskTopPx: 124,
    maskBottomPx: 824,
  },
  // 默写辅助加线的半宽。
  ledgerGuideHalfWidthPx: 20,
  // 点击/吸附半径相对于一格谱线间距的倍数。
  placementHitRadiusInStaffSpaces: 0.5,
} as const satisfies ResponsiveLabeledStaffLayoutProfile;

// 练习页“单音显示模式”的大谱表。
export const PRACTICE_SINGLE_STAFF_LAYOUT = {
  notationScale: 1,
  horizontal: {
    staffSidePaddingPx: 28,
    noteAreaSidePaddingPx: 75,
    minNoteAreaSidePaddingPx: 40,
  },
  vertical: {
    centerYPx: 75,
    gapPx: 114,
    ledgerGapPx: 114,
    trebleOnlyYPx: 75,
    bassOnlyYPx: 75,
    viewHeightPx: 260,
  },
  // 单音谱表允许使用的显示宽度。
  width: {
    minPx: 360,
    maxPx: 720,
  },
} as const satisfies StaffLayoutProfile;

// 练习页“谱页显示模式”的大谱表。
export const PRACTICE_PAGE_STAFF_LAYOUT = {
  notationScale: 1,
  horizontal: {
    staffSidePaddingPx: 24,
    noteAreaSidePaddingPx: 45,
    minNoteAreaSidePaddingPx: 24,
  },
  vertical: {
    centerYPx: 60,
    gapPx: 80,
    ledgerGapPx: 100,
    trebleOnlyYPx: 60,
    bassOnlyYPx: 60,
    viewHeightPx: 240,
  },
  // 整个谱页允许使用的显示宽度。
  width: {
    minPx: 720,
    maxPx: 980,
  },
  // 谱页的最大行数、每行题量和行间空白。
  multirow: {
    rows: 2,
    notesPerRow: 24,
    // 相邻两个固定行 viewport 之间的额外空白。
    rowGapPx: 10,
  },
} as const satisfies StaffLayoutProfile;
