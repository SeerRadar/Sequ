export const HEADER_SIZE = 17;
export const OFF_LENGTH = 0;
export const OFF_VERSION = 4;
export const OFF_CMD_ID = 5;
export const OFF_USER_ID = 9;
export const OFF_RESULT = 13;

export const MIN_PACKET_SIZE = HEADER_SIZE;
/** 与客户端 SocketEncryptImpl.PACKAGE_MAX 一致 */
export const MAX_PACKET_SIZE = 8388608;

export const PROTO_VERSION = 0x31;

/** 响应 result 字段超过此值即为错误包，客户端据此走 error 回调而非 cmd 回调 */
export const RESULT_ERROR_THRESHOLD = 1000;

export const CMD_LOGIN_IN = 1001;

/**
 * 响应会带回 result 新基线的命令：进服、断线重连。
 * 取自客户端 SocketEncryptImpl.parseData 的判定。
 */
export const RESULT_BASELINE_CMD_IDS: readonly number[] = [1001, 41463, 42387];

/** 登录阶段命令，均在登录网关或首次进服时使用 */
export const CMD_MAIN_LOGIN_IN = 103;
export const CMD_RANGE_ONLINE = 106;
export const CMD_SYS_ROLE = 109;
export const CMD_FORBID_CHECK = 111;

export const CMD_MAINTENANCE = 41457;

export interface ParsedPacket {
  length: number;
  version: number;
  cmdId: number;
  userId: number;
  result: number;
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
  const body = buf.subarray(HEADER_SIZE);

  return { length, version, cmdId, userId, result, body, raw: buf };
}

export type FrameResult =
  | { status: 'ok'; raw: Buffer; rest: Buffer }
  | { status: 'incomplete' }
  | { status: 'invalid'; length: number };

/**
 * 从缓冲区首部取出一个完整封包。
 *
 * 长度字段越界说明流已失步，由调用方决定是中断连接还是丢弃已缓冲数据。
 */
export function takeFrame(buffer: Buffer): FrameResult {
  if (buffer.length < HEADER_SIZE) return { status: 'incomplete' };

  const length = buffer.readUInt32BE(OFF_LENGTH);

  if (length < MIN_PACKET_SIZE || length > MAX_PACKET_SIZE) {
    return { status: 'invalid', length };
  }

  if (buffer.length < length) return { status: 'incomplete' };

  return {
    status: 'ok',
    raw: buffer.subarray(0, length),
    rest: buffer.subarray(length),
  };
}

export function validateHex(hex: string): boolean {
  const cleaned = hex.replace(/\s+/g, '');
  return /^[0-9A-Fa-f]+$/.test(cleaned);
}

export function cleanHex(hex: string): string {
  return hex.replace(/\s+/g, '');
}
