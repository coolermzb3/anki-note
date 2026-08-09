export interface VocalRenameRequest {
  id: string;
  name: string;
  token: number;
}

export function consumeVocalRenameRequest(
  request: VocalRenameRequest | null,
  token: number,
): VocalRenameRequest | null {
  return request?.token === token ? null : request;
}
