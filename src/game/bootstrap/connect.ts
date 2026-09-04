import net from 'net';

/**
 * 建立 TCP 连接；超时或出错时销毁 socket 并 reject
 */
export function connectSocket(
  ip: string,
  port: number,
  timeoutMs: number,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    const onError = (err: Error) => {
      clearTimeout(connectTimeout);
      reject(err);
    };

    const connectTimeout = setTimeout(() => {
      socket.removeListener('error', onError);
      socket.destroy();
      reject(new Error('TCP 连接超时 (10s)'));
    }, timeoutMs);

    socket.connect(port, ip, () => {
      clearTimeout(connectTimeout);
      socket.removeListener('error', onError);
      resolve(socket);
    });
    socket.on('error', onError);
  });
}
