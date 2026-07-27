import { describe, expect, it } from "vitest";
import {
  calculateMidiLatencyMetrics,
  formatMidiLatencyReport,
  isMidiLatencyDiagnosticsEnabled,
  summarizeMidiLatencySamples,
  type MidiLatencyCondition,
  type MidiLatencySample,
} from "./midiLatencyDiagnostics";

const staffAudioCondition: MidiLatencyCondition = {
  answerPitchMode: "note-name",
  correctDelayMs: 300,
  playAnswerNote: true,
  promptDisplayMode: "staff-page",
};

function makeSample(id: number, condition = staffAudioCondition, offset = 0): MidiLatencySample {
  return {
    condition,
    id,
    midiNoteNumber: 60,
    noteName: "C",
    octave: 4,
    outcome: "correct",
    recordedAt: "2026-07-28T00:00:00.000Z",
    timestamps: {
      nativeEvent: offset,
      midiHandler: offset + 5,
      published: offset + 6,
      practiceSubscriber: offset + 8,
      pressedReactCommit: offset + 24,
      pressedPaintApprox: offset + 42,
      submitStarted: offset + 9,
      verdict: offset + 10,
      feedbackRequested: offset + 11,
      reactCommit: offset + 30,
      paintApprox: offset + 50,
      transitionEnd: offset + 110,
      staffColorStarted: offset + 28,
      staffColorEnded: offset + 29,
      staffRenderStarted: offset + 31,
      staffRenderEnded: offset + 46,
      audioRequested: offset + 9,
      audioReady: offset + 19,
      reviewFinalizeStarted: offset + 12,
      reviewFinalizeEnded: offset + 27,
    },
  };
}

describe("MIDI latency diagnostics switch", () => {
  it("only enables the explicit timing query value", () => {
    expect(isMidiLatencyDiagnosticsEnabled("?midiTiming=1")).toBe(true);
    expect(isMidiLatencyDiagnosticsEnabled("?midiTiming=true")).toBe(false);
    expect(isMidiLatencyDiagnosticsEnabled("?midiTiming=0")).toBe(false);
    expect(isMidiLatencyDiagnosticsEnabled("?debug=indexeddb")).toBe(false);
  });
});

describe("MIDI latency metrics", () => {
  it("calculates browser-side segments from the same performance time origin", () => {
    expect(calculateMidiLatencyMetrics(makeSample(1))).toMatchObject({
      nativeToHandler: 5,
      handlerToSubscriber: 3,
      nativeToPressedPaint: 42,
      subscriberToVerdict: 2,
      verdictToCommit: 20,
      commitToPaint: 20,
      verdictToPaint: 40,
      transition: 80,
      staffColorUpdate: 1,
      staffRender: 15,
      audioReady: 10,
      reviewFinalize: 15,
      totalSoftware: 50,
    });
  });

  it("groups conditions and outcomes independently and excludes each first sample as warmup", () => {
    const singleSilentCondition: MidiLatencyCondition = {
      ...staffAudioCondition,
      playAnswerNote: false,
      promptDisplayMode: "single-note",
    };
    const groups = summarizeMidiLatencySamples([
      makeSample(1),
      makeSample(2, staffAudioCondition, 100),
      makeSample(3, singleSilentCondition, 200),
      { ...makeSample(4, singleSilentCondition, 300), outcome: "wrong" },
    ]);

    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ measuredCount: 1, outcome: "correct", totalCount: 2, warmupSampleId: 1 });
    expect(groups[0].metrics.totalSoftware).toEqual({ median: 50, max: 50 });
    expect(groups[1]).toMatchObject({ measuredCount: 0, outcome: "correct", totalCount: 1, warmupSampleId: 3 });
    expect(groups[2]).toMatchObject({ measuredCount: 0, outcome: "wrong", totalCount: 1, warmupSampleId: 4 });
  });

  it("formats a screenshot-friendly summary and raw sample section", () => {
    const report = formatMidiLatencyReport([makeSample(1), makeSample(2, staffAudioCondition, 100)]);

    expect(report).toContain("谱页 / 声音开 / 300ms");
    expect(report).toContain("300ms / 音名 / 正确");
    expect(report).toContain("/ 正确 · 统计 1 / 总计 2");
    expect(report).toContain("原生事件→项目回调: 5.0ms / 5.0ms");
    expect(report).toContain("#1 C4 正确 [预热]");
    expect(report).toContain("物理按键到浏览器原生事件不可由本日志测量");
  });
});
