import { describe, expect, it, vi } from "vitest";
import { handleWheelStep } from "./settingsWheel";

describe("settings range wheel direction", () => {
  it("blocks page scrolling and reports the matching step", () => {
    const preventDefault = vi.fn();
    const onStep = vi.fn();

    handleWheelStep({ deltaY: -1, preventDefault }, onStep);
    handleWheelStep({ deltaY: 1, preventDefault }, onStep);

    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(onStep.mock.calls).toEqual([[1], [-1]]);
  });

  it("ignores wheel events without a vertical delta", () => {
    const preventDefault = vi.fn();
    const onStep = vi.fn();

    handleWheelStep({ deltaY: 0, preventDefault }, onStep);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalled();
  });
});
