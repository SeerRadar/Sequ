import { Algorithms } from '../core/encrypt.js';
import { getCommandName } from '../utils/commandDict.js';
import {
  OFF_CMD_ID,
  OFF_LENGTH,
  OFF_VERSION,
  cleanHex,
  parsePacket,
  validateHex,
} from '../utils/pkg/protocol.js';
import type { ReceivePacketAnalysis } from './receive.js';
import net from 'net';

type MessageCallback = (message: string) => void;

export class SendPacketProcessing {
  private algorithms: Algorithms;
  private writer: net.Socket;
  private messageCallback: MessageCallback | null;
  private userId: Buffer;

  constructor(
    algorithms: Algorithms,
    writer: net.Socket,
    userid: number,
    messageCallback?: MessageCallback,
  ) {
    this.algorithms = algorithms;
    this.writer = writer;
    this.messageCallback = messageCallback || null;

    this.userId = Buffer.allocUnsafe(4);
    this.userId.writeUInt32BE(userid, 0);
  }

  parsePacket(buf: Buffer) {
    return parsePacket(buf);
  }

  groupPacket(hex: string): Buffer | null {
    try {
      const cleaned = cleanHex(hex);

      if (!validateHex(cleaned)) {
        throw new Error('包含非十六进制字符');
      }

      const raw = Buffer.from(cleaned, 'hex');
      const parsed = parsePacket(raw);

      if (!parsed) {
        throw new Error('数据包解析失败：字段提取不完整');
      }

      const resultValue = this.algorithms.calculateResult(
        parsed.cmdId,
        parsed.body,
      );
      const resultBuf = Buffer.allocUnsafe(4);
      resultBuf.writeUInt32BE(resultValue, 0);

      return Buffer.concat([
        raw.subarray(OFF_LENGTH, 4),
        raw.subarray(OFF_VERSION, 5),
        raw.subarray(OFF_CMD_ID, 9),
        this.userId,
        resultBuf,
        parsed.body,
      ]);
    } catch (error) {
      if (this.messageCallback) {
        this.messageCallback('发送|错误|封包数据格式错误');
      }
      console.error('组装数据包失败:', error);
      return null;
    }
  }

  async sendPacket(hexPkt: string): Promise<boolean> {
    try {
      const assembled = this.groupPacket(hexPkt);

      if (!assembled) {
        return false;
      }

      if (this.messageCallback) {
        const raw = Buffer.from(cleanHex(hexPkt), 'hex');
        if (raw.length >= 9) {
          const cmdId = raw.readUInt32BE(OFF_CMD_ID);
          const commandName = getCommandName(cmdId);
          this.messageCallback(
            `发送|[${cmdId}] ${commandName}|${assembled
              .toString('hex')
              .toUpperCase()}`,
          );
        }
      }

      return await this.writeToSocket(assembled);
    } catch (error) {
      console.error('发送数据包失败:', error);
      if (this.messageCallback) {
        this.messageCallback(`发送|错误|${(error as Error).message}`);
      }
      return false;
    }
  }

  async sendAndReceive(
    packedMessage: string,
    receiver: ReceivePacketAnalysis,
    expectedCmdId?: number,
    timeout: number = 5000,
  ): Promise<Buffer | null> {
    const assembledPacket = this.groupPacket(packedMessage);
    if (!assembledPacket) return null;

    let waitCmdId = expectedCmdId;
    if (waitCmdId === undefined) {
      const raw = Buffer.from(cleanHex(packedMessage), 'hex');
      if (raw.length < 9) {
        throw new Error('无法确定需要等待的 Command ID');
      }
      waitCmdId = raw.readUInt32BE(OFF_CMD_ID);
    }

    const receivePromise = receiver.waitForSpecificData(waitCmdId, timeout);

    await this.writeToSocket(assembledPacket);

    return receivePromise;
  }

  private writeToSocket(data: Buffer): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Socket连接已断开'));
        return;
      }

      this.writer.write(data, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve(true);
        }
      });
    });
  }

  setMessageCallback(callback: MessageCallback): void {
    this.messageCallback = callback;
  }

  isConnected(): boolean {
    if (!this.writer) return false;

    return (
      !this.writer.destroyed &&
      this.writer.readyState === 'open' &&
      this.writer.writable &&
      !this.writer.writableEnded
    );
  }
}
