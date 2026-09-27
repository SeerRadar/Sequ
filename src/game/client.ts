import type { RegionCredentials } from '../config/config.js';
import { settings } from '../config/config.js';
import { sendTextMessage } from '../notifications/feishu.js';
import { Login } from './bootstrap/login.js';
import { Algorithms } from './crypto.js';
import { getUnityNoticeInfo, parseUnityNotice } from './maintenance.js';
import { PacketBuilder } from './packet/builder.js';
import { buildPacket } from './packet/builder.js';
import { CMD_LOGIN_IN, HEADER_SIZE, OFF_CMD_ID } from './packet/protocol.js';
import { QueueWaitTimeoutError, SerialRequestQueue } from './queue.js';
import type { QueueStats } from './queue.js';
import type { RegionProfile } from './region.js';
import { ReceivePacketAnalysis } from './transport/receiver.js';
import { SendPacketProcessing } from './transport/sender.js';
import dayjs from 'dayjs';

const RECONNECT_BASE_MS = 4000;
const RECONNECT_MAX_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;
const MAINTENANCE_CHECK_MS = 60000;
/** 等待 cmd 1001 响应同步 result 基线的上限；超时只告警，不打断连接 */
const LOGIN_BASELINE_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 5 * 60 * 1000;
const QUEUE_ALERT_MAX_DEPTH = 30;
const QUEUE_ALERT_MAX_WAIT_MS = 5000;
const QUEUE_ALERT_INTERVAL_MS = 10 * 60 * 1000;

enum State {
  Initial,
  Ready,
  Reconnecting,
  Shutdown,
}

/**
 * 单个大区的 TCP 长连接服务：连接、串行队列与重连循环都属于实例，不跨大区共享。
 */
export class TCPService {
  private readonly profile: RegionProfile;

  private readonly credentials: RegionCredentials;
  private readonly queue: SerialRequestQueue<Buffer | null>;

  private sender: SendPacketProcessing | null = null;
  private receiver: ReceivePacketAnalysis | null = null;
  private state: State = State.Initial;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectFailure: Error | null = null;
  private reconnectAttempts: number = 0;

  private lastQueueAlertAt = 0;

  private readyWaiters: Array<{
    resolve: () => void;
    reject: (reason?: any) => void;
  }> = [];

  constructor(profile: RegionProfile, credentials: RegionCredentials) {
    this.profile = profile;
    this.credentials = credentials;
    this.queue = new SerialRequestQueue<Buffer | null>({
      name: `tcp-${profile.id}`,
      delayMs: settings.queue_delay_ms,
      maxLength: settings.queue_max_length,
      waitTimeoutMs: settings.queue_wait_timeout_ms,
      onMinute: (stats) => this._onQueueMinute(stats),
    });
  }

  // ---------- helpers ----------

  private _ts(): string {
    return dayjs().format('YYYY-MM-DD HH:mm:ss');
  }

  private _log(level: 'info' | 'warn' | 'err', ...args: unknown[]): void {
    const prefix = `[${this._ts()}] [${this.profile.id}]`;
    if (level === 'err') console.error(prefix, ...args);
    else if (level === 'warn') console.warn(prefix, ...args);
    else console.log(prefix, ...args);
  }

  /** 独立方法读取状态：绕过 TS 对 this.state 的窄化，确保 await 之后重新取值 */
  private _isShutdown(): boolean {
    return this.state === State.Shutdown;
  }

  private _cleanup(): void {
    if (this.receiver) {
      this.receiver.stop();
      this.receiver = null;
    }
    this.sender = null;
  }

  private _msgCallback(): ((msg: string) => void) | undefined {
    return settings.log_callbacks
      ? (msg: string) =>
          console.log(`[${this._ts()}] [${this.profile.id}] ${msg}`)
      : undefined;
  }

  // ---------- group helpers ----------

  private _notifyReady(): void {
    this.reconnectFailure = null;
    const waiters = this.readyWaiters.splice(0);
    for (const w of waiters) w.resolve();
  }

  private _notifyFailed(err: Error): void {
    const waiters = this.readyWaiters.splice(0);
    for (const w of waiters) w.reject(err);
  }

  private _waitUntilReady(timeoutMs?: number): Promise<void> {
    if (this.state === State.Ready) return Promise.resolve();
    if (this.state !== State.Reconnecting && this.reconnectFailure) {
      return Promise.reject(this.reconnectFailure);
    }

    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      const waiter = {
        resolve: () => {
          if (timer) clearTimeout(timer);
          resolve();
        },
        reject: (reason?: any) => {
          if (timer) clearTimeout(timer);
          reject(reason);
        },
      };

      // 超时后把等待者移出列表，避免故障期间等待者无限堆积
      if (timeoutMs) {
        timer = setTimeout(() => {
          const idx = this.readyWaiters.indexOf(waiter);
          if (idx !== -1) this.readyWaiters.splice(idx, 1);
          reject(
            new QueueWaitTimeoutError(
              `等待 TCP 就绪超时(>${timeoutMs}ms)，请稍后重试`,
            ),
          );
        }, timeoutMs);
      }

      this.readyWaiters.push(waiter);
    });
  }

  /** 所有告警统一带上大区，便于多实例共用同一个 webhook 时区分来源 */
  private _alert(msg: string): void {
    const task = sendTextMessage(
      `【${this.profile.label} (${this.profile.id})】${msg}`,
    );
    if (!task) return;
    void task.catch((err) =>
      console.error('【飞书】告警发送失败:', (err as Error).message),
    );
  }

  private _onMaintenanceNotice(remainSec: number): void {
    const minutes = Math.ceil(remainSec / 60);
    const msg =
      minutes > 60
        ? `服务器维护通知：约 ${Math.floor(minutes / 60)} 小时后关服`
        : `服务器维护通知：${minutes} 分钟后关服`;
    this._alert(msg);
  }

  private _onQueueMinute(stats: QueueStats): void {
    // 空闲周期不打日志，避免长期输出全零行
    if (
      stats.depth === 0 &&
      stats.executed === 0 &&
      stats.failed === 0 &&
      stats.waitTimeout === 0
    ) {
      return;
    }

    this._log(
      'info',
      `【队列】深度:${stats.depth} 执行:${stats.executed} 失败:${stats.failed} ` +
        `排队超时:${stats.waitTimeout} 平均等待:${stats.avgWaitMs}ms ` +
        `最大等待:${stats.maxWaitMs}ms 峰值深度:${stats.maxDepth}`,
    );

    if (
      stats.maxDepth < QUEUE_ALERT_MAX_DEPTH &&
      stats.maxWaitMs < QUEUE_ALERT_MAX_WAIT_MS
    ) {
      return;
    }

    const now = Date.now();
    if (now - this.lastQueueAlertAt < QUEUE_ALERT_INTERVAL_MS) return;
    this.lastQueueAlertAt = now;

    this._alert(
      `【seer-query 告警】TCP 请求队列拥堵\n` +
        `时间: ${this._ts()}\n` +
        `峰值深度: ${stats.maxDepth}\n` +
        `最大等待: ${stats.maxWaitMs}ms\n` +
        `排队超时: ${stats.waitTimeout}`,
    );
  }

  private _flushQueue(reason: string, error: Error): void {
    const flushed = this.queue.flush(error);
    if (flushed > 0) {
      this._log('warn', `【队列】${reason}，已拒绝 ${flushed} 个排队请求`);
    }
  }

  // ---------- connection life cycle ----------

  async init(): Promise<void> {
    try {
      await this._doConnect();
    } catch (error) {
      if (this.state === State.Shutdown) return;
      console.error(
        `初始化连接失败: ${(error as Error).message}，准备进入重连流程...`,
      );
      this._doStartReconnect();
      await this._waitUntilReady();
    }
  }

  private async _doConnect(): Promise<void> {
    this.state = State.Initial;
    const algorithms = new Algorithms();
    const login = new Login(this.profile, algorithms);

    this._log('info', `正在登录 ${this.profile.label} TCP 服务器...`);

    const socket = await login.login(
      this.credentials.accountId,
      this.credentials.password,
    );

    const msgCb = this._msgCallback();

    this.sender = new SendPacketProcessing(
      algorithms,
      socket,
      this.credentials.accountId,
      msgCb,
    );

    this.receiver = new ReceivePacketAnalysis({
      algorithms,
      tcpSocket: socket,
      messageCallback: msgCb,
      disconnectCallback: () => {
        this._log('warn', '【系统】网络连接已断开，准备重连...');
        this._startReconnect();
      },
      maintenanceCallback: (remainSec) => this._onMaintenanceNotice(remainSec),
      logFullPacket: settings.log_full_packet,
      ignoredCmdIds: settings.ignored_cmd_ids,
    });

    // login() 已发出登录包；等它的响应既让接收侧把 result 基线刷成服务端值，
    // 也证明服务端已受理登录
    const loginResponse = await this.receiver.waitForSpecificData(
      CMD_LOGIN_IN,
      LOGIN_BASELINE_TIMEOUT_MS,
    );

    if (!loginResponse) {
      this._log('warn', '【登录】未收到 cmd 1001 响应，result 基线仍未同步');
    }

    if (this.state !== State.Initial) {
      this._cleanup();
      throw new Error('TCP 连接在初始化期间被中断');
    }

    if (!this.sender?.isConnected()) {
      this._cleanup();
      throw new Error('TCP 连接在初始化期间断开');
    }

    this.state = State.Ready;
    this._log('info', 'TCP 初始化完成，result 序列号基线就绪！');
    this._notifyReady();
    this._startHeartbeat();
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      if (this.state !== State.Ready) return;

      if (!this.sender?.isConnected()) {
        this._log('warn', '【心跳】Socket 断开，触发重连');
        this._startReconnect();
        return;
      }

      try {
        const pkt2157 = buildPacket(2157, 1, this.credentials.accountId);
        await this.sendAndReceive(pkt2157);
        this._log('info', '【心跳】2157 保持连接成功');
      } catch (error) {
        this._log('err', '【心跳】发送失败:', (error as Error).message);
      }
    }, HEARTBEAT_MS);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ---------- reconnect ----------

  private _startReconnect(): void {
    if (
      this.state === State.Shutdown ||
      this.state === State.Reconnecting ||
      this.state === State.Initial
    ) {
      return;
    }
    this._doStartReconnect();
  }

  private _doStartReconnect(): void {
    this.state = State.Reconnecting;
    this.reconnectFailure = null;
    this._stopHeartbeat();
    this._cleanup();

    void this._reconnectLoop().catch((error) => {
      this._log('err', '【重连】异常错误:', (error as Error).message);
    });
  }

  private async _reconnectLoop(): Promise<void> {
    while (this.state === State.Reconnecting) {
      this._cleanup();
      this.reconnectAttempts++;

      const isMaintenance = await this._checkMaintenance();
      if (isMaintenance) {
        this.reconnectAttempts = 0;
        await new Promise((resolve) =>
          setTimeout(resolve, MAINTENANCE_CHECK_MS),
        );
        continue;
      }

      try {
        await this._doConnect();
        this.reconnectAttempts = 0;
        this._log('info', '【重连】连接成功！');
        this._notifyReady();
        return;
      } catch (error) {
        if (this._isShutdown()) return;

        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          const finalError = new Error(
            `TCP 重连失败，已连续尝试 ${MAX_RECONNECT_ATTEMPTS} 次`,
          );
          const alert =
            `【seer-query 告警】重连终止\n` +
            `时间: ${this._ts()}\n` +
            `原因: ${finalError.message}`;

          this._log('err', '【重连】', finalError.message);
          this._alert(alert);
          this.state = State.Initial;
          this.reconnectFailure = finalError;
          this._notifyFailed(finalError);

          this._flushQueue('重连终止', finalError);

          throw finalError;
        }

        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts - 1),
          RECONNECT_MAX_MS,
        );

        this._log(
          'err',
          `【重连】第 ${this.reconnectAttempts} 次失败: ${(error as Error).message}`,
        );
        this._log('info', `【重连】等待 ${delay / 1000}s 后重试...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async _checkMaintenance(): Promise<boolean> {
    try {
      const noticeList = await getUnityNoticeInfo(this.profile.noticeUrl);
      const result = parseUnityNotice(noticeList);
      if (result.status === '维护') {
        this._log('warn', '【重连】服务器维护中，等待...');
        return true;
      }
    } catch (err) {
      this._log('warn', `【重连】获取公告失败: ${(err as Error).message}`);
    }
    return false;
  }

  // ---------- public api ----------

  /**
   * 发送封包并等待响应。所有请求经由全局串行队列：
   * 同一时间至多一个在途请求，相邻请求完成之间保持
   * settings.queue_delay_ms 间隔。
   * 就绪等待放在队列之外：重连/维护期间不占用队列槽位，
   * 且与排队等待共享 settings.queue_wait_timeout_ms 上限，
   * 故障期间调用方在该时限内得到明确错误。
   */
  async sendAndReceive(
    pktOrHex: PacketBuilder | string,
    timeout = 5000,
  ): Promise<Buffer | null> {
    const hexPkt = typeof pktOrHex === 'string' ? pktOrHex : pktOrHex.build();

    if (this.state !== State.Ready) {
      if (this.state === State.Shutdown) {
        throw new Error('TCP 服务已关闭');
      }
      await this._waitUntilReady(settings.queue_wait_timeout_ms);
    }

    return this.queue.add(() => this._sendAndReceiveOnce(hexPkt, timeout));
  }

  private async _sendAndReceiveOnce(
    hexPkt: string,
    timeout: number,
  ): Promise<Buffer | null> {
    const pktBuf = Buffer.from(hexPkt, 'hex');
    const cmdId = pktBuf.readUInt32BE(OFF_CMD_ID);

    const doSend = async (): Promise<Buffer | null> => {
      if (!this.sender || !this.receiver) {
        throw new Error('TCP 未初始化');
      }

      const respPromise = this.receiver.waitForSpecificData(cmdId, timeout);
      const ok = await this.sender.sendPacket(hexPkt);

      if (!ok) throw new Error('封包发送失败');

      const data = await respPromise;
      return data?.subarray(HEADER_SIZE) ?? null;
    };

    if (this.state === State.Shutdown) {
      throw new Error('TCP 服务已关闭');
    }

    try {
      return await doSend();
    } catch (error) {
      if (this._isShutdown()) throw error;

      const msg = (error as Error).message;
      // 'TCP 未初始化'：排队/执行间隙连接断开导致发送器被清理，
      // 与断线错误同样走"重连等待后重试"，不再在发送前单独阻塞等就绪
      const retryable =
        msg.includes('Socket连接已断开') ||
        msg.includes('封包发送失败') ||
        msg.includes('TCP 未初始化');

      if (!retryable) throw error;

      this._log('warn', `【发送】连接异常，重连重试: ${msg}`);
      this._startReconnect();
      // 透明重试：等待重连完成后重发（期间持有队列槽位，属固有开销）
      await this._waitUntilReady();
      return doSend();
    }
  }

  shutdown(): void {
    this.state = State.Shutdown;
    this.reconnectFailure = new Error('TCP 服务已关闭');
    this._stopHeartbeat();
    this._cleanup();

    const waiters = this.readyWaiters.splice(0);
    for (const w of waiters) w.reject(this.reconnectFailure);

    this._flushQueue('服务关闭', this.reconnectFailure);
    this.queue.dispose();

    this._log('info', 'TCP 服务已关闭');
  }
}

export const tcpService = new TCPService(
  settings.regionProfile,
  settings.account,
);
