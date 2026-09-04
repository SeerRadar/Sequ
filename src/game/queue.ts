/**
 * 全局串行请求队列
 *
 * 游戏服务器只接受单线程访问，且协议层没有请求 ID、响应按 cmdId
 * FIFO 匹配 —— 并发发送会导致响应错配。所有 TCP 请求必须在
 * tcpService 收口到本队列：同一时间至多一个在途请求，相邻请求
 * 完成之间强制保持 delayMs 间隔。
 *
 * 排队等待超时仅约束"入队 → 开始执行"阶段；任务开始执行后
 * 由其自身超时控制。
 */

export interface QueueStats {
  depth: number;
  executed: number;
  failed: number;
  waitTimeout: number;
  avgWaitMs: number;
  maxWaitMs: number;
  maxDepth: number;
}

interface QueueTask<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  enqueuedAt: number;
  started: boolean;
}

export interface SerialQueueOptions {
  name: string;
  /** 相邻请求完成之间的最小间隔（毫秒） */
  delayMs: number;
  /** 队列最大长度，超出直接拒绝 */
  maxLength: number;
  /** 排队等待超时（毫秒），超时未开始执行则拒绝 */
  waitTimeoutMs: number;
  /** 每分钟统计回调（用于日志与告警） */
  onMinute?: (stats: QueueStats) => void;
}

export class QueueFullError extends Error {}

export class QueueWaitTimeoutError extends Error {}

const STATS_INTERVAL_MS = 60_000;

export class SerialRequestQueue<T> {
  private readonly name: string;
  private readonly delayMs: number;
  private readonly maxLength: number;
  private readonly waitTimeoutMs: number;
  private readonly onMinute?: (stats: QueueStats) => void;

  private queue: QueueTask<T>[] = [];
  private processing = false;
  private lastFinishedAt = 0;
  private disposed = false;

  private statsTimer: NodeJS.Timeout | null = null;
  private minute = {
    executed: 0,
    failed: 0,
    waitTimeout: 0,
    totalWaitMs: 0,
    maxWaitMs: 0,
    maxDepth: 0,
  };

  constructor(options: SerialQueueOptions) {
    this.name = options.name;
    this.delayMs = options.delayMs;
    this.maxLength = options.maxLength;
    this.waitTimeoutMs = options.waitTimeoutMs;
    this.onMinute = options.onMinute;
  }

  /** 入队并等待执行；队列已满或已关闭时直接抛出 */
  add(run: () => Promise<T>): Promise<T> {
    if (this.disposed) {
      throw new Error(`请求队列[${this.name}]已关闭，拒绝入队`);
    }

    if (this.queue.length >= this.maxLength) {
      throw new QueueFullError(
        `请求队列[${this.name}]已满(${this.queue.length}/${this.maxLength})，请稍后重试`,
      );
    }

    return new Promise<T>((resolve, reject) => {
      const task: QueueTask<T> = {
        run,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        started: false,
      };

      const timer = setTimeout(() => {
        if (task.started) return;
        const idx = this.queue.indexOf(task);
        if (idx !== -1) this.queue.splice(idx, 1);
        this.minute.waitTimeout++;
        reject(
          new QueueWaitTimeoutError(
            `请求队列[${this.name}]排队超时(>${this.waitTimeoutMs}ms)，请稍后重试`,
          ),
        );
      }, this.waitTimeoutMs);

      task.resolve = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      task.reject = (reason) => {
        clearTimeout(timer);
        reject(reason);
      };

      this.queue.push(task);
      this.minute.maxDepth = Math.max(this.minute.maxDepth, this.queue.length);
      this._startStatsTimer();

      void this._process();
    });
  }

  /** 排队中（未开始执行）的任务数，不含在途任务 */
  get depth(): number {
    return this.queue.length;
  }

  /** 拒绝并清空所有尚未开始的任务（连接终止/服务关闭时调用） */
  flush(error: Error): number {
    const tasks = this.queue.splice(0);
    for (const task of tasks) task.reject(error);
    return tasks.length;
  }

  dispose(): void {
    this.disposed = true;
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  private async _process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift()!;
        task.started = true;

        const waitedMs = Date.now() - task.enqueuedAt;
        this.minute.executed++;
        this.minute.totalWaitMs += waitedMs;
        this.minute.maxWaitMs = Math.max(this.minute.maxWaitMs, waitedMs);

        // 与上一个请求完成时刻保持至少 delayMs 间隔
        if (this.lastFinishedAt > 0) {
          const gap = Date.now() - this.lastFinishedAt;
          if (gap < this.delayMs) {
            await new Promise((resolve) =>
              setTimeout(resolve, this.delayMs - gap),
            );
          }
        }

        try {
          const result = await task.run();
          task.resolve(result);
        } catch (error) {
          this.minute.failed++;
          task.reject(error as Error);
        } finally {
          this.lastFinishedAt = Date.now();
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private _startStatsTimer(): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(() => {
      const {
        executed,
        failed,
        waitTimeout,
        totalWaitMs,
        maxWaitMs,
        maxDepth,
      } = this.minute;
      this.minute = {
        executed: 0,
        failed: 0,
        waitTimeout: 0,
        totalWaitMs: 0,
        maxWaitMs: 0,
        maxDepth: 0,
      };

      const stats: QueueStats = {
        depth: this.queue.length,
        executed,
        failed,
        waitTimeout,
        avgWaitMs: executed > 0 ? Math.round(totalWaitMs / executed) : 0,
        maxWaitMs,
        maxDepth,
      };

      this.onMinute?.(stats);
    }, STATS_INTERVAL_MS);
  }
}
