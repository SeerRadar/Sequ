import type { GateAddress, RegionProfile } from '../region.js';
import { connectSocket } from './connect.js';
import axios from 'axios';
import type net from 'net';

const GATE_FETCH_TIMEOUT_MS = 5000;
const GATE_CONNECT_TIMEOUT_MS = 10000;

/**
 * 取一条区域登录网关地址，失败时回退到区域档案里的兜底地址。
 *
 * 网关列表是纯文本，多条以 `|` 分隔（形如 `1.2.3.4:1864|5.6.7.8:1864`）。
 */
export async function resolveGate(
  profile: RegionProfile,
): Promise<GateAddress> {
  try {
    const { data } = await axios.get<string>(profile.gateUrl, {
      timeout: GATE_FETCH_TIMEOUT_MS,
    });

    const entries = String(data)
      .split('|')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const picked = entries[Math.floor(Math.random() * entries.length)];
    if (picked) {
      const [ip, port] = picked.split(':');
      const portNum = parseInt(port ?? '', 10);

      if (ip && Number.isFinite(portNum) && portNum > 0) {
        return { ip, port: portNum };
      }

      console.error(`网关地址格式异常 (${profile.id}): ${picked}`);
    } else {
      console.error(`网关地址列表为空 (${profile.id})`);
    }
  } catch (error) {
    console.error(
      `获取网关地址失败 (${profile.id}):`,
      (error as Error).message,
    );
  }

  return { ...profile.defaultGate };
}

/**
 * 打开登录网关连接执行 fn，无论成败都在结束时关闭。
 *
 * 引导阶段与网关的交互都是「连上、来回几个包、断开」，连接生命周期集中在这里。
 */
export async function withGate<T>(
  profile: RegionProfile,
  fn: (socket: net.Socket) => Promise<T>,
): Promise<T> {
  const gate = await resolveGate(profile);
  const socket = await connectSocket(
    gate.ip,
    gate.port,
    GATE_CONNECT_TIMEOUT_MS,
  );

  try {
    return await fn(socket);
  } finally {
    socket.destroy();
  }
}
