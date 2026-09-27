/**
 * result 序列号算法。
 *
 * 每个封包的 result 由上一个 result 与当前包体递推得出，服务端据此校验封包顺序；
 * 基线命令（protocol.ts 的 RESULT_BASELINE_CMD_IDS）的响应带回新基线，接收侧用它覆写当前值。
 *
 * 协议不加密封包：客户端同名逻辑算出的「密钥」从未参与收发，故这里没有密钥字段。
 */
export class Algorithms {
  private result = 0;

  setResult(value: number): void {
    this.result = value;
  }

  /**
   * 与客户端 SocketEncryptImpl.packHead 一致：cmd <= 1000 的封包恒填 0 且不改变基线，
   * 只有 cmd > 1000 才参与递推。
   */
  calculateResult(cmdId: number, body: Buffer): number {
    if (cmdId <= 1000) return 0;

    let crc8 = 0;
    for (const byte of body) {
      crc8 ^= byte;
    }

    this.result = this.MSerial(this.result, body.length, crc8, cmdId);
    return this.result;
  }

  private MSerial(a: number, b: number, c: number, d: number): number {
    return a + c + Math.trunc(a / -3) + (b % 17) + (d % 23) + 120;
  }
}
