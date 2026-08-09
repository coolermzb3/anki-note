import { describe, expect, it } from "vitest";
import { consumeVocalRenameRequest, type VocalRenameRequest } from "./renameRequest";

const REQUEST: VocalRenameRequest = { id: "material-1", name: "录音", token: 7 };

describe("consumeVocalRenameRequest", () => {
  it("clears a request after its token is consumed", () => {
    expect(consumeVocalRenameRequest(REQUEST, 7)).toBeNull();
  });

  it("keeps a newer request when an older token finishes", () => {
    expect(consumeVocalRenameRequest(REQUEST, 6)).toBe(REQUEST);
  });
});
