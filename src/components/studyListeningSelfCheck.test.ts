import { describe, expect, it } from "vitest";
import { getNotesForGroups } from "../domain/notes";
import {
  beginHeldNoteSequence,
  findNearestAnswerPitch,
  getListeningTargetNoteName,
  getUniqueStudyPitches,
  recordListeningAttempt,
  releaseHeldNoteSequence,
  selectFreeSinglePitch,
  selectListeningSelfCheckTarget,
  shouldRerollListeningTarget,
  type HeldNoteSequence,
} from "./studyListeningSelfCheck";

const middlePitches = getUniqueStudyPitches(getNotesForGroups(["G3-F4"], true, "grand"));

function createHeldNoteSequence(): HeldNoteSequence {
  return { cancelled: false, releases: [], settled: Promise.resolve() };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("study listening self-check", () => {
  it("deduplicates staff spellings before selecting audible pitches", () => {
    expect(middlePitches.map((pitch) => pitch.pitchId)).toEqual(["G3", "A3", "B3", "C4", "D4", "E4", "F4"]);
  });

  it("selects single pitches uniformly while avoiding the previous pitch on a reroll", () => {
    const first = selectListeningSelfCheckTarget("single", middlePitches, undefined, () => 0);
    expect(first?.mode).toBe("single");
    expect(first && getListeningTargetNoteName(first)).toBe("G");

    const next = selectListeningSelfCheckTarget("single", middlePitches, first, () => 0);
    expect(next?.mode === "single" ? next.pitch.pitchId : undefined).toBe("A3");
  });

  it("selects octave targets by note name while avoiding the previous name", () => {
    const first = selectListeningSelfCheckTarget("octaves", middlePitches, undefined, () => 0);
    expect(first).toEqual({ mode: "octaves", noteName: "C" });
    expect(selectListeningSelfCheckTarget("octaves", middlePitches, first, () => 0)).toEqual({
      mode: "octaves",
      noteName: "D",
    });
  });

  it("uses a random available pitch for free single-note playback", () => {
    const pitches = getUniqueStudyPitches(getNotesForGroups(["G3-F4", "G4-F5"], false, "grand"));
    expect(selectFreeSinglePitch("G", pitches, () => 0)?.pitchId).toBe("G3");
    expect(selectFreeSinglePitch("G", pitches, () => 0.99)?.pitchId).toBe("G4");
  });

  it("uses the nearest available answer pitch within the selected range", () => {
    const target = middlePitches.find((pitch) => pitch.pitchId === "D4");
    expect(target).toBeDefined();
    expect(target && findNearestAnswerPitch("G", target, middlePitches)?.pitchId).toBe("G3");
  });

  it("prefers the target's numbered octave when distances are tied", () => {
    const pitches = getUniqueStudyPitches(getNotesForGroups(["G3-F4", "G4-F5"], false, "grand"));
    const target = pitches.find((pitch) => pitch.pitchId === "F4");
    expect(target).toBeDefined();
    expect(target && findNearestAnswerPitch("B", target, pitches)?.pitchId).toBe("B4");
  });

  it("keeps a wrong target locked until it is solved", () => {
    expect(shouldRerollListeningTarget("untouched")).toBe(true);
    expect(shouldRerollListeningTarget("wrong")).toBe(false);
    expect(shouldRerollListeningTarget("solved")).toBe(true);
    expect(recordListeningAttempt("untouched", false)).toBe("wrong");
    expect(recordListeningAttempt("wrong", false)).toBe("wrong");
    expect(recordListeningAttempt("wrong", true)).toBe("solved");
    expect(recordListeningAttempt("solved", false)).toBe("solved");
  });

  it("settles a held prompt before attacking its correct answer", async () => {
    const prompt = createHeldNoteSequence();
    const answer = createHeldNoteSequence();
    const promptAttack = deferred();
    const events: string[] = [];

    beginHeldNoteSequence(prompt, [middlePitches[0]], Promise.resolve(), async () => {
      events.push("prompt attack started");
      await promptAttack.promise;
      return { release: () => events.push("prompt released") };
    });
    await Promise.resolve();

    const promptSettled = releaseHeldNoteSequence(prompt);
    beginHeldNoteSequence(answer, [middlePitches[1]], promptSettled, async () => {
      events.push("answer attacked");
      return { release: () => undefined };
    });
    expect(events).toEqual(["prompt attack started"]);

    promptAttack.resolve();
    await answer.settled;
    expect(events).toEqual(["prompt attack started", "prompt released", "answer attacked"]);
  });

  it("does not attack an answer released before the prompt settles", async () => {
    const prompt = createHeldNoteSequence();
    const answer = createHeldNoteSequence();
    const promptAttack = deferred();
    const events: string[] = [];

    beginHeldNoteSequence(prompt, [middlePitches[0]], Promise.resolve(), async () => {
      await promptAttack.promise;
      return { release: () => events.push("prompt released") };
    });
    await Promise.resolve();

    beginHeldNoteSequence(answer, [middlePitches[1]], releaseHeldNoteSequence(prompt), async () => {
      events.push("answer attacked");
      return { release: () => undefined };
    });
    const answerSettled = releaseHeldNoteSequence(answer);
    promptAttack.resolve();
    await answerSettled;

    expect(events).toEqual(["prompt released"]);
  });
});
