export const ENHANCED_PITCH_MODEL_CACHE = "anki-note-vocal-pitch-models-v1";
export const ENHANCED_PITCH_MODEL_BYTES = 43_817_123 + 399_114;
export const ENHANCED_PITCH_REMINDER_KEY = "anki-note.vocalPitch.enhancedReminderDate";

export type EnhancedPitchModelName = "fcpe" | "swiftf0";

interface EnhancedPitchModelDefinition {
  bytes: number;
  fileName: string;
  sha256: string;
}

const MODEL_DEFINITIONS: Record<EnhancedPitchModelName, EnhancedPitchModelDefinition> = {
  fcpe: {
    bytes: 43_817_123,
    fileName: "fcpe-v1.onnx",
    sha256: "d425a36c66d751558574f230dd6caff682d2b1bdccf57315e3c907677e8b1d1c",
  },
  swiftf0: {
    bytes: 399_114,
    fileName: "swift-f0-v1.onnx",
    sha256: "fa91bb45512b90339cf4b00a599ba8fe3a253c46419fcfe6b46df77a8a8336a5",
  },
};

function localDateKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function enhancedPitchModelUrl(name: EnhancedPitchModelName): string {
  const baseUrl = new URL(import.meta.env.BASE_URL, globalThis.location.href);
  return new URL(`models/vocal-pitch/${MODEL_DEFINITIONS[name].fileName}`, baseUrl).href;
}

export function isEnhancedPitchReminderSuppressedToday(
  storage: Pick<Storage, "getItem"> = localStorage,
  now = new Date(),
): boolean {
  return storage.getItem(ENHANCED_PITCH_REMINDER_KEY) === localDateKey(now);
}

export function suppressEnhancedPitchReminderToday(
  storage: Pick<Storage, "setItem"> = localStorage,
  now = new Date(),
): void {
  storage.setItem(ENHANCED_PITCH_REMINDER_KEY, localDateKey(now));
}

export async function areEnhancedPitchModelsCached(): Promise<boolean> {
  if (!("caches" in globalThis)) return false;
  const cache = await caches.open(ENHANCED_PITCH_MODEL_CACHE);
  const matches = await Promise.all(
    (Object.keys(MODEL_DEFINITIONS) as EnhancedPitchModelName[]).map((name) => cache.match(enhancedPitchModelUrl(name))),
  );
  return matches.every((response, index) => {
    const definition = MODEL_DEFINITIONS[(Object.keys(MODEL_DEFINITIONS) as EnhancedPitchModelName[])[index]];
    return response?.ok && response.headers.get("X-Anki-Note-SHA256") === definition.sha256;
  });
}

async function verifiedModelResponse(name: EnhancedPitchModelName, bytes: ArrayBuffer): Promise<Response> {
  const definition = MODEL_DEFINITIONS[name];
  if (bytes.byteLength !== definition.bytes) {
    throw new Error(`增强模型大小不符：${definition.fileName}`);
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (digest !== definition.sha256) {
    throw new Error(`增强模型校验失败：${definition.fileName}`);
  }
  return new Response(bytes, {
    headers: {
      "Content-Length": String(definition.bytes),
      "Content-Type": "application/octet-stream",
      "X-Anki-Note-SHA256": definition.sha256,
    },
  });
}

async function fetchModel(
  name: EnhancedPitchModelName,
  onBytes: (downloaded: number) => void,
): Promise<Response> {
  const response = await fetch(enhancedPitchModelUrl(name), { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`增强模型下载失败（HTTP ${response.status}）`);
  }
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    onBytes(bytes.byteLength);
    return verifiedModelResponse(name, bytes);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.byteLength;
    onBytes(downloaded);
  }
  const bytes = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return verifiedModelResponse(name, bytes.buffer);
}

export async function downloadEnhancedPitchModels(onProgress: (progress: number) => void): Promise<void> {
  if (!("caches" in globalThis)) {
    throw new Error("当前浏览器不支持模型缓存");
  }
  const cache = await caches.open(ENHANCED_PITCH_MODEL_CACHE);
  let completedBytes = 0;
  onProgress(0);
  for (const name of Object.keys(MODEL_DEFINITIONS) as EnhancedPitchModelName[]) {
    const definition = MODEL_DEFINITIONS[name];
    const cached = await cache.match(enhancedPitchModelUrl(name));
    if (cached?.ok && cached.headers.get("X-Anki-Note-SHA256") === definition.sha256) {
      completedBytes += definition.bytes;
      onProgress(completedBytes / ENHANCED_PITCH_MODEL_BYTES);
      continue;
    }
    const response = await fetchModel(name, (downloaded) => {
      onProgress(Math.min(1, (completedBytes + downloaded) / ENHANCED_PITCH_MODEL_BYTES));
    });
    await cache.put(enhancedPitchModelUrl(name), response);
    completedBytes += definition.bytes;
    onProgress(completedBytes / ENHANCED_PITCH_MODEL_BYTES);
  }
}

export async function loadEnhancedPitchModel(name: EnhancedPitchModelName): Promise<ArrayBuffer> {
  const url = enhancedPitchModelUrl(name);
  const cached = "caches" in globalThis
    ? await (await caches.open(ENHANCED_PITCH_MODEL_CACHE)).match(url)
    : undefined;
  if (!cached?.ok || cached.headers.get("X-Anki-Note-SHA256") !== MODEL_DEFINITIONS[name].sha256) {
    throw new Error("增强模型缓存已丢失，请重新下载");
  }
  return cached.arrayBuffer();
}
