import { describe, expect, it } from "vitest";
import { createUuid } from "./id";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createUuid", () => {
  it("uses native randomUUID when available", () => {
    expect(
      createUuid({
        randomUUID: () => "11111111-1111-4111-8111-111111111111",
        getRandomValues: (array) => array,
      }),
    ).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    const generated = createUuid({
      randomUUID: undefined,
      getRandomValues: (array) => {
        array.fill(0xab);
        return array;
      },
    });

    expect(generated).toMatch(UUID_V4_PATTERN);
  });
});
