function randomBase64Url(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Buffer.from(buffer).toString("base64url");
}

/** Short, URL-safe room id (72 bits of randomness). */
export function newRoomId(): string {
  return randomBase64Url(9);
}

/** Unguessable invite token for private rooms (192 bits). */
export function newInviteToken(): string {
  return randomBase64Url(24);
}
