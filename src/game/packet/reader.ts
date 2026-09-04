/**
 * 二进制读取工具类 - 封装缓冲读取逻辑，自动管理偏移量
 */
class BufferReader {
  private buffer: Buffer;
  private _offset: number;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this._offset = 0;
  }

  readUInt32(): number {
    this.checkRemaining(4, 'readUInt32');
    const value = this.buffer.readUInt32BE(this._offset);
    this._offset += 4;
    return value;
  }

  readUInt16(): number {
    this.checkRemaining(2, 'readUInt16');
    const value = this.buffer.readUInt16BE(this._offset);
    this._offset += 2;
    return value;
  }

  readUInt8(): number {
    this.checkRemaining(1, 'readUInt8');
    const value = this.buffer.readUInt8(this._offset);
    this._offset += 1;
    return value;
  }

  readString(length: number): string {
    this.checkRemaining(length, 'readString');
    const end = this._offset + length;
    const strBuffer = this.buffer.slice(this._offset, end);
    this._offset = end;
    // eslint-disable-next-line no-control-regex
    return strBuffer.toString('utf8').replace(/\u0000/g, '');
  }

  skip(bytes: number): void {
    this.checkRemaining(bytes, 'skip');
    this._offset += bytes;
  }

  private checkRemaining(requiredBytes: number, operation: string): void {
    const remaining = this.buffer.length - this._offset;
    if (remaining < requiredBytes) {
      throw new Error(
        `Buffer underflow in ${operation}: required ${requiredBytes} bytes, but only ${remaining} bytes remaining (offset: ${this._offset}, length: ${this.buffer.length})`,
      );
    }
  }
}

export { BufferReader };
