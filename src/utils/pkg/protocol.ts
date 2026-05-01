export const HEADER_SIZE = 17;
export const OFF_LENGTH = 0;
export const OFF_VERSION = 4;
export const OFF_CMD_ID = 5;
export const OFF_USER_ID = 9;
export const OFF_RESULT = 13;

export const MIN_PACKET_SIZE = HEADER_SIZE;
export const MAX_PACKET_SIZE = 1024 * 1024;

export const PROTO_VERSION = 0x31;

export const CMD_KEY_INIT = 1001;
export const CMD_MAINTENANCE = 41457;

export interface ParsedPacket {
  length: number;
  version: number;
  cmdId: number;
  userId: number;
  result: number;
  header: Buffer;
  body: Buffer;
  raw: Buffer;
}

export function parsePacket(buf: Buffer): ParsedPacket | null {
  if (buf.length < HEADER_SIZE) return null;

  const length = buf.readUInt32BE(OFF_LENGTH);
  const version = buf.readUInt8(OFF_VERSION);
  const cmdId = buf.readUInt32BE(OFF_CMD_ID);
  const userId = buf.readUInt32BE(OFF_USER_ID);
  const result = buf.readUInt32BE(OFF_RESULT);
  const header = buf.subarray(0, HEADER_SIZE);
  const body = buf.subarray(HEADER_SIZE);

  return { length, version, cmdId, userId, result, header, body, raw: buf };
}

export function validateHex(hex: string): boolean {
  const cleaned = hex.replace(/\s+/g, '');
  return /^[0-9A-Fa-f]+$/.test(cleaned);
}

export function cleanHex(hex: string): string {
  return hex.replace(/\s+/g, '');
}
