import { describe, expect, it } from "vitest";
import { createSerialTaskQueue } from "./serialTaskQueue";

describe("createSerialTaskQueue", () => {
  it("runs tasks in submission order", async () => {
    const enqueue = createSerialTaskQueue();
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = enqueue(async () => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
    });
    const second = enqueue(async () => {
      order.push("second");
    });

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("continues after a task fails", async () => {
    const enqueue = createSerialTaskQueue();
    await expect(enqueue(async () => {
      throw new Error("failed");
    })).rejects.toThrow("failed");
    await expect(enqueue(async () => 42)).resolves.toBe(42);
  });

  it("does not block work submitted to another queue", async () => {
    const enqueueBackup = createSerialTaskQueue();
    const enqueueMutation = createSerialTaskQueue();
    let releaseBackup: () => void = () => undefined;
    const backupGate = new Promise<void>((resolve) => {
      releaseBackup = resolve;
    });

    const backup = enqueueBackup(() => backupGate);
    await expect(enqueueMutation(async () => "saved locally")).resolves.toBe("saved locally");
    releaseBackup();
    await backup;
  });
});
