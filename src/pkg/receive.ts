import { Algorithms } from '../core/encrypt.js';
import { getCommandName } from '../utils/commandDict.js';
import {
  CMD_KEY_INIT,
  CMD_MAINTENANCE,
  HEADER_SIZE,
  MAX_PACKET_SIZE,
  MIN_PACKET_SIZE,
  OFF_LENGTH,
  type ParsedPacket,
  parsePacket,
} from '../utils/pkg/protocol.js';
import { sendTextMessage } from '../utils/webHook/feishu.js';
import { EventEmitter } from 'events';
import net from 'net';

export interface ReceivePacketOptions {
  algorithms: Algorithms;
  tcpSocket: net.Socket;
  userId: number;
  messageCallback?: (msg: string) => void;
  disconnectCallback?: () => Promise<void> | void;
  logFullPacket?: boolean;
  ignoredCmdIds?: number[];
}

const DEFAULT_IGNORED_CMD_IDS = [8002, 3452, 2004, 2001, 41228, 1002, 2002];

export class ReceivePacketAnalysis extends EventEmitter {
  private algorithms: Algorithms;
  private tcpSocket: net.Socket;
  private userid: number;

  private messageCallback?: (msg: string) => void;
  private disconnectCallback?: () => Promise<void> | void;

  private waiters: Map<number, Array<(value: Buffer | null) => void>> =
    new Map();

  private buffer: Buffer = Buffer.alloc(0);
  private running: boolean = true;
  private disconnectHandled: boolean = false;

  private logFullPacket: boolean;
  private ignoredCmdIds: Set<number>;

  constructor(options: ReceivePacketOptions) {
    super();
    this.algorithms = options.algorithms;
    this.tcpSocket = options.tcpSocket;
    this.userid = options.userId;
    this.messageCallback = options.messageCallback;
    this.disconnectCallback = options.disconnectCallback;
    this.logFullPacket = options.logFullPacket ?? false;
    this.ignoredCmdIds = new Set(
      options.ignoredCmdIds ?? DEFAULT_IGNORED_CMD_IDS,
    );

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
    this.emit('error', error);
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
    this.emit('close');
  }

  private _processBuffer(): void {
    while (this.buffer.length >= HEADER_SIZE) {
      try {
        const packetLength = this.buffer.readUInt32BE(OFF_LENGTH);

        if (packetLength < MIN_PACKET_SIZE || packetLength > MAX_PACKET_SIZE) {
          this._message(`接收|错误|异常封包长度: ${packetLength}`);
          this.buffer = Buffer.alloc(0);
          break;
        }

        if (this.buffer.length < packetLength) {
          break;
        }

        const raw = this.buffer.subarray(0, packetLength);
        this.buffer = this.buffer.subarray(packetLength);

        const packet = parsePacket(raw);
        if (!packet) {
          this._message('接收|错误|封包解析失败');
          continue;
        }

        this._handlePacket(packet);
      } catch (error) {
        this._message(`接收|错误|${(error as Error).message}`);
        this.buffer = Buffer.alloc(0);
        break;
      }
    }
  }

  private _handlePacket(packet: ParsedPacket): void {
    const commandName = getCommandName(packet.cmdId);

    if (packet.cmdId === CMD_MAINTENANCE) {
      this._handleServerMaintenance(packet);
    }

    this._logReceive(packet);

    const queue = this.waiters.get(packet.cmdId);
    if (queue && queue.length > 0) {
      const resolve = queue.shift();
      if (queue.length === 0) this.waiters.delete(packet.cmdId);
      if (resolve) resolve(packet.raw);
    }

    if (packet.cmdId === CMD_KEY_INIT) {
      this._handleKeyInit(packet);
    }

    this.emit('packet', {
      commandId: packet.cmdId,
      commandName,
      packetData: packet.raw,
    });
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

  private _handleKeyInit(packet: ParsedPacket): void {
    this.algorithms.InitKey(packet.raw, this.userid);
    this._message('初始化|成功|密钥初始化完成');
    this.algorithms.setResult(packet.result);
    this._message(`初始化|更新|Result: ${packet.result}`);
  }

  private _handleServerMaintenance(packet: ParsedPacket): void {
    if (packet.body.length < 4) return;
    const ts = packet.body.readUInt32BE(0);

    if (!ts || ts < 1000000000) return;

    const now = Math.floor(Date.now() / 1000);
    const remainSec = ts - now;

    if (remainSec <= 0) return;

    this.emit('server:maintenance', {
      timestamp: ts,
      remainSec,
    });

    const minutes = Math.ceil(remainSec / 60);

    const msg =
      minutes > 60
        ? `服务器维护通知：约 ${Math.floor(minutes / 60)} 小时后关服`
        : `服务器维护通知：${minutes} 分钟后关服`;

    sendTextMessage(msg);
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
