import { PROTO_VERSION } from './protocol.js';

export function buildPacket(cmdId: number, ...params: number[]): string {
  const builder = new PacketBuilder().setCmdId(cmdId);
  for (const param of params) {
    builder.addU32(param);
  }
  return builder.build();
}

/**
 * 数据包构建工具类
 */
export class PacketBuilder {
  private length: number = 0;
  private version: number = PROTO_VERSION;
  private cmdId: number = 0;
  private userId: number = 0;
  private result: number = 0;
  private bodyParts: Buffer[] = [];

  setCmdId(cmdId: number): this {
    this.cmdId = cmdId;
    return this;
  }

  setUserId(userId: number): this {
    this.userId = userId;
    return this;
  }

  /**
   * 指定 result 字段。引导封包（cmd > 1000）需按序列号算法自行计算后写入
   */
  setResult(result: number): this {
    this.result = result;
    return this;
  }

  /**
   * 添加 4 字节整数到包体 (大端序)
   */
  addU32(value: number): this {
    const buffer = Buffer.allocUnsafe(4);
    buffer.writeUInt32BE(value, 0);
    this.bodyParts.push(buffer);
    return this;
  }

  /**
   * 添加定长字符串字段：UTF-8 写入，不足补 0，超出截断。
   * 截断按字节进行，可能切断多字节字符，故字段值约定为 ASCII
   */
  addFixedString(value: string, length: number): this {
    const buffer = Buffer.alloc(length, 0);
    buffer.write(value, 0, 'utf8');
    return this.addBytes(buffer);
  }

  addFixedBytes(bytes: Buffer, length: number): this {
    const buffer = Buffer.alloc(length, 0);
    bytes.copy(buffer, 0, 0, Math.min(bytes.length, length));
    return this.addBytes(buffer);
  }

  /** 包体内容，供需要自行计算 result 的引导封包取用 */
  bodyBuffer(): Buffer {
    return this.bodyParts.length > 0
      ? Buffer.concat(this.bodyParts)
      : Buffer.alloc(0);
  }

  /**
   * 添加原始字节 Buffer 到包体
   */
  addBytes(bytes: Buffer): this {
    this.bodyParts.push(bytes);
    return this;
  }

  /**
   * 添加十六进制字符串到包体
   */
  addHex(hex: string): this {
    this.bodyParts.push(Buffer.from(hex, 'hex'));
    return this;
  }

  /**
   * 构建完整数据包的十六进制字符串（供 SendPacketProcessing.sendPacket 使用）
   */
  build(): string {
    const body = this.bodyBuffer();

    // 总长度 = 头部(17字节) + 包体长度
    this.length = 17 + body.length;

    const lengthBuffer = Buffer.allocUnsafe(4);
    lengthBuffer.writeUInt32BE(this.length, 0);

    const versionBuffer = Buffer.from([this.version]);

    const cmdIdBuffer = Buffer.allocUnsafe(4);
    cmdIdBuffer.writeUInt32BE(this.cmdId, 0);

    const userIdBuffer = Buffer.allocUnsafe(4);
    userIdBuffer.writeUInt32BE(this.userId, 0);

    const resultBuffer = Buffer.allocUnsafe(4);
    resultBuffer.writeUInt32BE(this.result, 0);

    const packet = Buffer.concat([
      lengthBuffer,
      versionBuffer,
      cmdIdBuffer,
      userIdBuffer,
      resultBuffer,
      body,
    ]);

    return packet.toString('hex').toUpperCase();
  }
}
