import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as ort from "onnxruntime-web/wasm";
import { describe, expect, it } from "vitest";

ort.env.wasm.numThreads = 1;

const FCPE_PATH = resolve("public/models/vocal-pitch/fcpe-v1.onnx");
const SWIFTF0_PATH = resolve("public/models/vocal-pitch/swift-f0-v1.onnx");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sine(frequencyHz: number): Float32Array {
  return Float32Array.from(
    { length: 16_000 },
    (_, index) => 0.2 * Math.sin(2 * Math.PI * frequencyHz * index / 16_000),
  );
}

function median(values: number[]): number {
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
}

function decodeFcpe(latent: Float32Array): number[] {
  const minCent = 1200 * Math.log2(32.7 / 10);
  const maxCent = 1200 * Math.log2(1975.5 / 10);
  const step = (maxCent - minCent) / 359;
  const frequencies: number[] = [];
  for (let frame = 0; frame < latent.length / 360; frame += 1) {
    const offset = frame * 360;
    let maxIndex = 0;
    for (let bin = 1; bin < 360; bin += 1) {
      if (latent[offset + bin] > latent[offset + maxIndex]) maxIndex = bin;
    }
    if (latent[offset + maxIndex] <= 0.006) continue;
    let weightedCent = 0;
    let weight = 0;
    for (let relative = -4; relative <= 4; relative += 1) {
      const bin = Math.max(0, Math.min(359, maxIndex + relative));
      weightedCent += (minCent + bin * step) * latent[offset + bin];
      weight += latent[offset + bin];
    }
    frequencies.push(10 * 2 ** (weightedCent / weight / 1200));
  }
  return frequencies;
}

describe("enhanced pitch model artifacts", () => {
  it("pins the browser model files that passed the reference comparison", async () => {
    const [fcpe, swiftf0] = await Promise.all([readFile(FCPE_PATH), readFile(SWIFTF0_PATH)]);
    expect(sha256(fcpe)).toBe("d425a36c66d751558574f230dd6caff682d2b1bdccf57315e3c907677e8b1d1c");
    expect(sha256(swiftf0)).toBe("fa91bb45512b90339cf4b00a599ba8fe3a253c46419fcfe6b46df77a8a8336a5");
  });

  it("keeps both models near a 220 Hz synthetic reference", async () => {
    const samples = sine(220);
    const fcpeSession = await ort.InferenceSession.create(await readFile(FCPE_PATH), { executionProviders: ["wasm"] });
    const swiftSession = await ort.InferenceSession.create(await readFile(SWIFTF0_PATH), { executionProviders: ["wasm"] });
    try {
      const fcpeOutput = await fcpeSession.run({
        [fcpeSession.inputNames[0]]: new ort.Tensor("float32", samples, [1, samples.length, 1]),
      });
      const fcpeHz = decodeFcpe(fcpeOutput[fcpeSession.outputNames[0]].data as Float32Array);
      expect(fcpeHz.length).toBeGreaterThan(90);
      expect(median(fcpeHz)).toBeCloseTo(220, 0);

      const swiftOutput = await swiftSession.run({
        [swiftSession.inputNames[0]]: new ort.Tensor("float32", samples, [1, samples.length]),
      });
      const pitchHz = swiftOutput[swiftSession.outputNames[0]].data as Float32Array;
      const confidence = swiftOutput[swiftSession.outputNames[1]].data as Float32Array;
      expect(pitchHz.length).toBeGreaterThan(50);
      expect(median(Array.from(pitchHz))).toBeCloseTo(220, 0);
      expect(Math.max(...confidence)).toBeGreaterThan(0.9);
    } finally {
      await Promise.all([fcpeSession.release(), swiftSession.release()]);
    }
  }, 30_000);
});
