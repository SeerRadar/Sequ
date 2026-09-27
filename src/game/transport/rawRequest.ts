import { takeFrame } from '../packet/protocol.js';
import type net from 'net';

const RESPONSE_TIMEOUT_MS = 10000;

/**
 * 在裸 socket 上发送一个封包并等待首个完整响应。
 *
 * 仅用于引导阶段（网关握手、服务器列表枚举）：此时尚未建立串行队列，
 * 且响应是「一问一答」的固定模式。
 */
export function requestOnce(
  socket: net.Socket,
  packet: Buffer,
  timeoutMs: number = RESPONSE_TIMEOUT_MS,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new Error('等待响应超时')));
    }, timeoutMs);

    const onError = (error: Error) => settle(() => reject(error));

    const onData = (data: Buffer): void => {
      buffer = Buffer.concat([buffer, data]);

      const frame = takeFrame(buffer);

      if (frame.status === 'incomplete') return;

      if (frame.status === 'invalid') {
        settle(() => reject(new Error(`异常封包长度: ${frame.length}`)));
        return;
      }

      settle(() => resolve(frame.raw));
    };

    socket.on('data', onData);
    socket.on('error', onError);
    socket.write(packet);
  });
}
