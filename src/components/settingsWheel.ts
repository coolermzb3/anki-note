export type WheelStepDirection = -1 | 1;
type WheelStepEvent = Pick<WheelEvent, "deltaY" | "preventDefault">;

export function getWheelStepDirection(deltaY: number): WheelStepDirection | undefined {
  if (deltaY < 0) {
    return 1;
  }
  if (deltaY > 0) {
    return -1;
  }
  return undefined;
}

export function handleWheelStep(event: WheelStepEvent, onStep: (direction: WheelStepDirection) => void): void {
  const direction = getWheelStepDirection(event.deltaY);
  if (direction === undefined) {
    return;
  }
  event.preventDefault();
  onStep(direction);
}
