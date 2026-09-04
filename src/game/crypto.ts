import crypto from 'crypto';

export class Algorithms {
  private key: Buffer;
  private result: number;

  constructor() {
    this.key = Buffer.from('!crAckmE4nOthIng:-)', 'utf-8');
    this.result = 0;
  }

  /** 初始化 Key */
  InitKey(packetData: Buffer, userId: number): void {
    const lastFourBytes = packetData.subarray(packetData.length - 4);
    const lastUint = lastFourBytes.readUInt32BE();
    const xorResult = lastUint ^ userId;
    const xorStr = xorResult.toString();
    const md5Hash = crypto.createHash('md5').update(xorStr).digest('hex');
    const newKey = md5Hash.slice(0, 10);
    this.key = Buffer.from(newKey, 'utf-8');
    console.log('Updated encryption key to:', this.key.toString());
  }

  /** 设置 result 初始值（由 1001 握手包提供） */
  setResult(value: number): void {
    this.result = value;
  }

  /** 计算序列号 */
  private MSerial(a: number, b: number, c: number, d: number): number {
    return a + c + Math.trunc(a / -3) + (b % 17) + (d % 23) + 120;
  }

  /** 计算结果 */
  calculateResult(cmdId: number, body: Buffer): number {
    let crc8_val = 0;
    if (cmdId > 1000) {
      for (const byte of body) {
        crc8_val ^= byte;
      }
    }
    const newResult = this.MSerial(this.result, body.length, crc8_val, cmdId);
    this.result = newResult;
    return newResult;
  }
}
