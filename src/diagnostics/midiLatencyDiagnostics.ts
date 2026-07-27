import type { AnswerPitchMode, PianoKeyName, PromptDisplayMode } from "../domain/types";

export type MidiLatencyStage =
  | "nativeEvent"
  | "midiHandler"
  | "published"
  | "practiceSubscriber"
  | "pressedReactCommit"
  | "pressedPaintApprox"
  | "submitStarted"
  | "verdict"
  | "audioRequested"
  | "audioReady"
  | "feedbackRequested"
  | "reactCommit"
  | "paintApprox"
  | "transitionEnd"
  | "reviewFinalizeStarted"
  | "reviewFinalizeEnded"
  | "staffColorStarted"
  | "staffColorEnded"
  | "staffRenderStarted"
  | "staffRenderEnded";

export interface MidiLatencyCondition {
  answerPitchMode: AnswerPitchMode;
  correctDelayMs: number;
  playAnswerNote: boolean;
  promptDisplayMode: PromptDisplayMode;
}

export interface MidiLatencySample {
  condition?: MidiLatencyCondition;
  id: number;
  midiNoteNumber: number;
  noteName: PianoKeyName;
  octave: number;
  outcome?: "correct" | "wrong";
  recordedAt: string;
  timestamps: Partial<Record<MidiLatencyStage, number>>;
}

export type MidiLatencyMetric =
  | "nativeToHandler"
  | "handlerToSubscriber"
  | "nativeToPressedPaint"
  | "subscriberToVerdict"
  | "verdictToCommit"
  | "commitToPaint"
  | "verdictToPaint"
  | "transition"
  | "staffColorUpdate"
  | "staffRender"
  | "audioReady"
  | "reviewFinalize"
  | "totalSoftware";

export interface MidiLatencyMetricSummary {
  max: number;
  median: number;
}

export interface MidiLatencySummaryGroup {
  condition: MidiLatencyCondition;
  key: string;
  measuredCount: number;
  metrics: Partial<Record<MidiLatencyMetric, MidiLatencyMetricSummary>>;
  outcome: "correct" | "wrong";
  totalCount: number;
  warmupSampleId: number;
}

const MAX_SAMPLES = 1_000;
const PUBLISH_DELAY_MS = 900;
const listeners = new Set<() => void>();
const publishTimers = new Map<number, number>();
const samplesById = new Map<number, MidiLatencySample>();
let samples: MidiLatencySample[] = [];
let nextSampleId = 1;

export const MIDI_LATENCY_DIAGNOSTICS_ENABLED = isMidiLatencyDiagnosticsEnabled();

function now(): number {
  return performance.now();
}

function getSample(id: number | undefined): MidiLatencySample | undefined {
  return id === undefined ? undefined : samplesById.get(id);
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function schedulePublish(id: number): void {
  const previousTimer = publishTimers.get(id);
  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }
  const timer = window.setTimeout(() => {
    publishTimers.delete(id);
    notify();
  }, PUBLISH_DELAY_MS);
  publishTimers.set(id, timer);
}

function markAt(id: number | undefined, stage: MidiLatencyStage, value: number): void {
  const sample = getSample(id);
  if (!sample || sample.timestamps[stage] !== undefined) {
    return;
  }
  sample.timestamps[stage] = value;
  if (sample.outcome !== undefined) {
    schedulePublish(sample.id);
  }
}

function validDelta(start: number | undefined, end: number | undefined): number | undefined {
  if (start === undefined || end === undefined) {
    return undefined;
  }
  const delta = end - start;
  return delta >= 0 && delta < 60_000 ? delta : undefined;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function summarizeValues(values: readonly number[]): MidiLatencyMetricSummary | undefined {
  return values.length === 0 ? undefined : { max: Math.max(...values), median: median(values) };
}

export function isMidiLatencyDiagnosticsEnabled(search = typeof window === "undefined" ? "" : window.location.search): boolean {
  const value = new URLSearchParams(search).get("midiTiming");
  return value === "1";
}

export function startMidiLatencySample(input: {
  handlerAt: number;
  midiNoteNumber: number;
  nativeEventAt: number;
  noteName: PianoKeyName;
  octave: number;
}): number | undefined {
  if (!MIDI_LATENCY_DIAGNOSTICS_ENABLED) {
    return undefined;
  }
  const sample: MidiLatencySample = {
    id: nextSampleId,
    midiNoteNumber: input.midiNoteNumber,
    noteName: input.noteName,
    octave: input.octave,
    recordedAt: new Date().toISOString(),
    timestamps: {
      nativeEvent: input.nativeEventAt,
      midiHandler: input.handlerAt,
    },
  };
  nextSampleId += 1;
  samples.push(sample);
  samplesById.set(sample.id, sample);
  if (samples.length > MAX_SAMPLES) {
    const removed = samples.shift();
    if (removed) {
      samplesById.delete(removed.id);
    }
  }
  return sample.id;
}

export function markMidiLatencyStage(
  id: number | undefined,
  stage: MidiLatencyStage,
  value?: number,
): void {
  if (!MIDI_LATENCY_DIAGNOSTICS_ENABLED) {
    return;
  }
  markAt(id, stage, value ?? now());
}

export function setMidiLatencyCondition(id: number | undefined, condition: MidiLatencyCondition): void {
  if (!MIDI_LATENCY_DIAGNOSTICS_ENABLED) {
    return;
  }
  const sample = getSample(id);
  if (sample) {
    sample.condition = condition;
  }
}

export function completeMidiLatencySample(id: number | undefined, outcome: "correct" | "wrong"): void {
  if (!MIDI_LATENCY_DIAGNOSTICS_ENABLED) {
    return;
  }
  const sample = getSample(id);
  if (!sample) {
    return;
  }
  sample.outcome = outcome;
  schedulePublish(sample.id);
}

export function getMidiLatencySamples(): MidiLatencySample[] {
  return samples
    .filter((sample) => sample.outcome !== undefined)
    .map((sample) => ({ ...sample, condition: sample.condition ? { ...sample.condition } : undefined, timestamps: { ...sample.timestamps } }));
}

export function subscribeMidiLatencySamples(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearMidiLatencySamples(): void {
  for (const timer of publishTimers.values()) {
    window.clearTimeout(timer);
  }
  publishTimers.clear();
  samples = [];
  samplesById.clear();
  notify();
}

export function calculateMidiLatencyMetrics(sample: MidiLatencySample): Partial<Record<MidiLatencyMetric, number>> {
  const timestamps = sample.timestamps;
  return {
    nativeToHandler: validDelta(timestamps.nativeEvent, timestamps.midiHandler),
    handlerToSubscriber: validDelta(timestamps.midiHandler, timestamps.practiceSubscriber),
    nativeToPressedPaint: validDelta(timestamps.nativeEvent, timestamps.pressedPaintApprox),
    subscriberToVerdict: validDelta(timestamps.practiceSubscriber, timestamps.verdict),
    verdictToCommit: validDelta(timestamps.verdict, timestamps.reactCommit),
    commitToPaint: validDelta(timestamps.reactCommit, timestamps.paintApprox),
    verdictToPaint: validDelta(timestamps.verdict, timestamps.paintApprox),
    transition: validDelta(timestamps.reactCommit, timestamps.transitionEnd),
    staffColorUpdate: validDelta(timestamps.staffColorStarted, timestamps.staffColorEnded),
    staffRender: validDelta(timestamps.staffRenderStarted, timestamps.staffRenderEnded),
    audioReady: validDelta(timestamps.audioRequested, timestamps.audioReady),
    reviewFinalize: validDelta(timestamps.reviewFinalizeStarted, timestamps.reviewFinalizeEnded),
    totalSoftware: validDelta(timestamps.nativeEvent, timestamps.paintApprox),
  };
}

export function midiLatencyConditionKey(condition: MidiLatencyCondition): string {
  return [
    condition.promptDisplayMode,
    condition.playAnswerNote ? "audio-on" : "audio-off",
    `delay-${condition.correctDelayMs}`,
    condition.answerPitchMode,
  ].join("|");
}

export function summarizeMidiLatencySamples(input: readonly MidiLatencySample[]): MidiLatencySummaryGroup[] {
  const grouped = new Map<
    string,
    { condition: MidiLatencyCondition; outcome: "correct" | "wrong"; samples: MidiLatencySample[] }
  >();
  for (const sample of input) {
    if (!sample.outcome || !sample.condition) {
      continue;
    }
    const key = `${midiLatencyConditionKey(sample.condition)}|${sample.outcome}`;
    const group = grouped.get(key) ?? { condition: sample.condition, outcome: sample.outcome, samples: [] };
    group.samples.push(sample);
    grouped.set(key, group);
  }

  return [...grouped.entries()].map(([key, group]) => {
    const measuredSamples = group.samples.slice(1);
    const sampleMetrics = measuredSamples.map(calculateMidiLatencyMetrics);
    const metricNames: MidiLatencyMetric[] = [
      "nativeToHandler",
      "handlerToSubscriber",
      "nativeToPressedPaint",
      "subscriberToVerdict",
      "verdictToCommit",
      "commitToPaint",
      "verdictToPaint",
      "transition",
      "staffColorUpdate",
      "staffRender",
      "audioReady",
      "reviewFinalize",
      "totalSoftware",
    ];
    const metrics: Partial<Record<MidiLatencyMetric, MidiLatencyMetricSummary>> = {};
    for (const metricName of metricNames) {
      const summary = summarizeValues(
        sampleMetrics
          .map((metric) => metric[metricName])
          .filter((value): value is number => value !== undefined),
      );
      if (summary) {
        metrics[metricName] = summary;
      }
    }
    return {
      condition: group.condition,
      key,
      measuredCount: measuredSamples.length,
      metrics,
      outcome: group.outcome,
      totalCount: group.samples.length,
      warmupSampleId: group.samples[0].id,
    };
  });
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "-" : `${value.toFixed(1)}ms`;
}

export function formatMidiLatencyCondition(condition: MidiLatencyCondition, separator = " / "): string {
  const display = condition.promptDisplayMode === "staff-page" ? "谱页" : "单音";
  const audio = condition.playAnswerNote ? "声音开" : "声音关";
  const pitch = condition.answerPitchMode === "exact-pitch" ? "精确音高" : "音名";
  return [display, audio, `${condition.correctDelayMs}ms`, pitch].join(separator);
}

export function formatMidiLatencyReport(input: readonly MidiLatencySample[]): string {
  const groups = summarizeMidiLatencySamples(input);
  const warmupIds = new Set(groups.map((group) => group.warmupSampleId));
  const lines = [
    "MIDI 延迟诊断",
    `生成时间: ${new Date().toISOString()}`,
    "说明: 正确/答错分别分组，每组首个样本为预热，不计入汇总；物理按键到浏览器原生事件不可由本日志测量。",
    "",
    "分组汇总（中位数 / 最大值）",
  ];
  if (groups.length === 0) {
    lines.push("暂无 MIDI 答题样本");
  }
  for (const group of groups) {
    const metric = (name: MidiLatencyMetric): string => {
      const summary = group.metrics[name];
      return summary ? `${formatMs(summary.median)} / ${formatMs(summary.max)}` : "-";
    };
    lines.push(
      "",
      `${formatMidiLatencyCondition(group.condition)} / ${group.outcome === "correct" ? "正确" : "答错"} · 统计 ${group.measuredCount} / 总计 ${group.totalCount}`,
      `原生事件→项目回调: ${metric("nativeToHandler")}`,
      `项目回调→练习订阅: ${metric("handlerToSubscriber")}`,
      `原生事件→按下画面: ${metric("nativeToPressedPaint")}`,
      `练习订阅→判定: ${metric("subscriberToVerdict")}`,
      `判定→React提交: ${metric("verdictToCommit")}`,
      `React提交→画面近似: ${metric("commitToPaint")}`,
      `判定→画面近似: ${metric("verdictToPaint")}`,
      `颜色过渡: ${metric("transition")}`,
      `谱页着色: ${metric("staffColorUpdate")}`,
      `谱页重绘: ${metric("staffRender")}`,
      `音频调用: ${metric("audioReady")}`,
      `记录保存: ${metric("reviewFinalize")}`,
      `原生事件→画面近似: ${metric("totalSoftware")}`,
    );
  }

  lines.push("", "最近样本");
  for (const sample of [...input].reverse().slice(0, 20)) {
    const metrics = calculateMidiLatencyMetrics(sample);
    const condition = sample.condition ? formatMidiLatencyCondition(sample.condition) : "未进入练习";
    const outcome = sample.outcome === "correct" ? "正确" : sample.outcome === "wrong" ? "答错" : "待定";
    lines.push(
      "",
      `#${sample.id} ${sample.noteName}${sample.octave} ${outcome}${warmupIds.has(sample.id) ? " [预热]" : ""}`,
      condition,
      `原生→回调 ${formatMs(metrics.nativeToHandler)} | 原生→按下画面 ${formatMs(metrics.nativeToPressedPaint)} | 订阅→判定 ${formatMs(metrics.subscriberToVerdict)}`,
      `判定→提交 ${formatMs(metrics.verdictToCommit)} | 提交→画面 ${formatMs(metrics.commitToPaint)} | 总软件 ${formatMs(metrics.totalSoftware)}`,
      `过渡 ${formatMs(metrics.transition)} | 谱页着色 ${formatMs(metrics.staffColorUpdate)} | 谱页重绘 ${formatMs(metrics.staffRender)}`,
      `音频 ${formatMs(metrics.audioReady)} | 保存 ${formatMs(metrics.reviewFinalize)}`,
    );
  }
  return lines.join("\n");
}
