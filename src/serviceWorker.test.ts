import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync("public/service-worker.js", "utf8");

function loadWorker(scope = "https://example.com/scoretone/") {
  const listeners = new Map<string, (event: any) => void>();
  const caches = {
    keys: vi.fn().mockResolvedValue([
      "anki-note-v1",
      "anki-note-v2",
      "anki-note-vocal-pitch-models-v1",
      "other-app-v1",
    ]),
    delete: vi.fn().mockResolvedValue(true),
    match: vi.fn().mockResolvedValue("cached page"),
  };
  const fetch = vi.fn().mockRejectedValue(new Error("offline"));
  runInNewContext(workerSource, {
    URL,
    caches,
    fetch,
    self: {
      registration: { scope },
      location: { origin: new URL(scope).origin },
      clients: { claim: vi.fn().mockResolvedValue(undefined) },
      addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener),
    },
  });
  return { listeners, caches, fetch };
}

describe("service worker during the ScoreTone rename", () => {
  it("removes only obsolete app-shell caches, retaining models and other apps", async () => {
    const { listeners, caches } = loadWorker();
    let completion: Promise<unknown> | undefined;
    listeners.get("activate")!({ waitUntil: (promise: Promise<unknown>) => { completion = promise; } });
    await completion;
    expect(caches.delete.mock.calls).toEqual([["anki-note-v1"]]);
  });

  it.each(["scoretone", "anki-note"])("uses the %s scope for offline navigation", async (name) => {
    const { listeners, caches } = loadWorker(`https://example.com/${name}/`);
    let response: Promise<unknown> | undefined;
    listeners.get("fetch")!({
      request: { method: "GET", mode: "navigate", url: `https://example.com/${name}/` },
      respondWith: (promise: Promise<unknown>) => { response = promise; },
    });
    await expect(response).resolves.toBe("cached page");
    expect(caches.match).toHaveBeenCalledWith(`https://example.com/${name}/index.html`);
  });

  it.each([
    "https://example.com/anki-note/",
    "https://example.com/other-app/asset.js",
    "https://example.com/scoretone-other/",
    "https://another.example.com/scoretone/",
  ])("leaves requests outside its scope untouched: %s", (url) => {
    const { listeners, fetch } = loadWorker();
    const respondWith = vi.fn();
    listeners.get("fetch")!({ request: { method: "GET", mode: "navigate", url }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
