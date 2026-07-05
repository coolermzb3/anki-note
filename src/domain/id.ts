function randomHex(bytes: Uint8Array): string[] {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
}

function fillWithMathRandom(bytes: Uint8Array): void {
  const timestamp = Date.now();
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[0] ^= timestamp & 0xff;
  bytes[1] ^= (timestamp >> 8) & 0xff;
  bytes[2] ^= (timestamp >> 16) & 0xff;
  bytes[3] ^= (timestamp >> 24) & 0xff;
}

interface UuidCrypto {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

export function createUuid(cryptoApi: UuidCrypto | undefined = globalThis.crypto): string {
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    fillWithMathRandom(bytes);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = randomHex(bytes);
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
