import { Algorithms } from '../crypto.js';
import { getCommandName } from '../packet/commands.js';
import {
  CMD_MAINTENANCE,
  type ParsedPacket,
  RESULT_BASELINE_CMD_IDS,
  RESULT_ERROR_THRESHOLD,
  parsePacket,
  takeFrame,
} from '../packet/protocol.js';
import type net from 'net';

export interface ReceivePacketOptions {
  algorithms: Algorithms;
  tcpSocket: net.Socket;
  messageCallback?: (msg: string) => void;
  disconnectCallback?: () => Promise<void> | void;
  /** 收到服务器维护通知时回调（剩余秒数），由连接所有者决定告警方式 */
  maintenanceCallback?: (remainSec: number) => void;
  logFullPacket?: boolean;
  ignoredCmdIds: number[];
}

export class ReceivePacketAnalysis {
  private algorithms: Algorithms;
  private tcpSocket: net.Socket;

  private messageCallback?: (msg: string) => void;
  private disconnectCallback?: () => Promise<void> | void;
  private maintenanceCallback?: (remainSec: number) => void;

  private waiters: Map<number, Array<(value: Buffer | null) => void>> =
    new Map();

  private buffer: Buffer = Buffer.alloc(0);
  private running: boolean = true;
  private disconnectHandled: boolean = false;

  private logFullPacket: boolean;
  private ignoredCmdIds: Set<number>;

  constructor(options: ReceivePacketOptions) {
    this.algorithms = options.algorithms;
    this.tcpSocket = options.tcpSocket;
    this.messageCallback = options.messageCallback;
    this.disconnectCallback = options.disconnectCallback;
    this.maintenanceCallback = options.maintenanceCallback;
    this.logFullPacket = options.logFullPacket ?? false;
    this.ignoredCmdIds = new Set(options.ignoredCmdIds);

    this._setupSocketListeners();
  }

  private _message(msg: string): void {
    if (this.messageCallback) this.messageCallback(msg);
  }

  private _setupSocketListeners(): void {
    if (!this.tcpSocket || this.tcpSocket.destroyed) {
      this._message('连接|错误|未连接到服务器');
      return;
    }

    this.tcpSocket.on('data', (data: Buffer) => {
      if (!this.running) return;
      this.buffer = Buffer.concat([this.buffer, data]);
      this._processBuffer();
    });

    this.tcpSocket.on('error', async (error: Error) => {
      await this._onSocketError(error);
    });

    this.tcpSocket.on('close', async () => {
      await this._onSocketClose();
    });
  }

  private async _onSocketError(error: Error): Promise<void> {
    this._message(`接收|错误|${error.message}`);
    this.running = false;
    if (!this.disconnectHandled && this.disconnectCallback) {
      this.disconnectHandled = true;
      await this.disconnectCallback();
    }
  }

  private async _onSocketClose(): Promise<void> {
    if (this.running) {
      this._message('连接|断开|服务器断开连接');
    }
    this.running = false;
    if (!this.disconnectHandled && this.disconnectCallback) {
      this.disconnectHandled = true;
      await this.disconnectCallback();
    }
  }

  private _processBuffer(): void {
    let frame = takeFrame(this.buffer);

    while (frame.status === 'ok') {
      this.buffer = frame.rest;

      try {
        const packet = parsePacket(frame.raw);

        if (packet) {
          this._handlePacket(packet);
        } else {
          this._message('接收|错误|封包解析失败');
        }
      } catch (error) {
        this._message(`接收|错误|${(error as Error).message}`);
        this.buffer = Buffer.alloc(0);
        return;
      }

      frame = takeFrame(this.buffer);
    }

    if (frame.status === 'invalid') {
      this._message(`接收|错误|异常封包长度: ${frame.length}`);
      this.buffer = Buffer.alloc(0);
    }
  }

  private _handlePacket(packet: ParsedPacket): void {
    if (packet.cmdId === CMD_MAINTENANCE) {
      this._handleServerMaintenance(packet);
    }

    this._logReceive(packet);

    // 先同步基线再唤醒等待者：等待这些命令的调用方拿到响应时 result 已是新基线
    if (RESULT_BASELINE_CMD_IDS.includes(packet.cmdId)) {
      this._handleResultBaseline(packet);
    }

    // result 超阈值即错误包，客户端在此走错误回调；这里只记录，命令等待者照常唤醒
    if (packet.result > RESULT_ERROR_THRESHOLD) {
      this._message(
        `接收|错误|cmd ${packet.cmdId} 返回错误码 ${packet.result}`,
      );
    }

    const queue = this.waiters.get(packet.cmdId);
    if (queue && queue.length > 0) {
      const resolve = queue.shift();
      if (queue.length === 0) this.waiters.delete(packet.cmdId);
      if (resolve) resolve(packet.raw);
    }
  }

  private _logReceive(packet: ParsedPacket): void {
    if (!this.messageCallback || this.ignoredCmdIds.has(packet.cmdId)) return;

    const commandName = getCommandName(packet.cmdId);

    if (this.logFullPacket) {
      const cipher = packet.raw.toString('hex').toUpperCase();
      this._message(`接收|[${packet.cmdId}] ${commandName}|${cipher}`);
    } else {
      this._message(
        `接收|[${packet.cmdId}] ${commandName}|length:${packet.length}`,
      );
    }
  }

  private _handleResultBaseline(packet: ParsedPacket): void {
    this.algorithms.setResult(packet.result);
    this._message(`基线更新|cmd=${packet.cmdId}|result=${packet.result}`);
  }

  private _handleServerMaintenance(packet: ParsedPacket): void {
    if (packet.body.length < 4) return;
    const ts = packet.body.readUInt32BE(0);

    if (!ts || ts < 1000000000) return;

    const now = Math.floor(Date.now() / 1000);
    const remainSec = ts - now;

    if (remainSec <= 0) return;

    this.maintenanceCallback?.(remainSec);
  }

  async waitForSpecificData(
    commandId: number,
    timeout: number = 5000,
  ): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const wrappedResolve = (val: Buffer | null) => {
        clearTimeout(timer);
        resolve(val);
      };

      const timer = setTimeout(() => {
        const queue = this.waiters.get(commandId);
        if (queue) {
          const idx = queue.indexOf(wrappedResolve);
          if (idx !== -1) queue.splice(idx, 1);
          if (queue.length === 0) this.waiters.delete(commandId);
        }
        this._message(`等待|超时|命令 ${commandId} 响应超时`);
        resolve(null);
      }, timeout);

      if (!this.waiters.has(commandId)) {
        this.waiters.set(commandId, []);
      }
      this.waiters.get(commandId)!.push(wrappedResolve);
    });
  }

  stop(): void {
    this.running = false;
    this.disconnectHandled = true;

    for (const queue of this.waiters.values()) {
      for (const resolve of queue) {
        resolve(null);
      }
    }
    this.waiters.clear();

    this.buffer = Buffer.alloc(0);

    if (this.tcpSocket && !this.tcpSocket.destroyed) {
      this.tcpSocket.removeAllListeners();
      this.tcpSocket.destroy();
    }
  }
}
