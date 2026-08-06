import { describe, expect, it } from "vitest";
import { encodeMonoWavPcm16 } from "./wavEncode";

describe("encodeMonoWavPcm16", () => {
  it("writes a well-formed 44-byte PCM header", async () => {
    const blob = encodeMonoWavPcm16(new Float32Array(3), 44_100);
    const view = new DataView(await blob.arrayBuffer());
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));

    expect(blob.type).toBe("audio/wav");
    expect(view.byteLength).toBe(44 + 3 * 2);
    expect(ascii(0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 3 * 2);
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint32(28, true)).toBe(44_100 * 2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(3 * 2);
  });

  it("encodes samples as little-endian PCM16 with clamping", async () => {
    const blob = encodeMonoWavPcm16(new Float32Array([0, 0.5, -0.5, 1, -1, 2]), 16_000);
    const view = new DataView(await blob.arrayBuffer());

    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 32767));
    expect(view.getInt16(48, true)).toBe(Math.round(-0.5 * 32767));
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32767);
    expect(view.getInt16(54, true)).toBe(32767);
  });
});
