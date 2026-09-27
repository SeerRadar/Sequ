import { PacketBuilder } from '../packet/builder.js';
import { CMD_RANGE_ONLINE, parsePacket } from '../packet/protocol.js';
import { BufferReader } from '../packet/reader.js';
import type { GameServer, RegionProfile } from '../region.js';
import { requestOnce } from '../transport/rawRequest.js';
import { withGate } from './gate.js';

/** cmd 106 单条服务器记录的字节数：onlineID + 人数 + IP(16) + 端口 + 好友数 */
const SERVER_RECORD_SIZE = 30;
const IP_FIELD_SIZE = 16;

/**
 * 服务器列表查询：在登录网关上用 cmd 106 RANGE_ONLINE 拉取区域扫描区间内的服务器。
 * 该命令不需要 session。
 */
export class Svr {
  constructor(private readonly profile: RegionProfile) {}

  async getSvrInfo(): Promise<GameServer> {
    const [start, end] = this.profile.serverScanRange;
    const servers = await this.getRangeServer(start, end);

    if (servers.length === 0) {
      console.error(`[${this.profile.id}] 未查询到服务器，使用兜底地址`);
      return { ...this.profile.defaultServer };
    }

    return servers[Math.floor(Math.random() * servers.length)]!;
  }

  private async getRangeServer(
    start: number,
    end: number,
  ): Promise<GameServer[]> {
    return withGate(this.profile, async (socket) => {
      const builder = new PacketBuilder()
        .setCmdId(CMD_RANGE_ONLINE)
        .addU32(start)
        .addU32(end)
        .addU32(0);

      const response = await requestOnce(
        socket,
        Buffer.from(builder.build(), 'hex'),
      );

      const parsed = parsePacket(response);
      if (!parsed) {
        throw new Error('cmd 106 响应解析失败');
      }

      return parseRangeSvrInfo(parsed.body, this.profile.excludedServerIds);
    });
  }
}

/** 解析 cmd 106 响应体：[在线数量][onlineID, 人数, IP(16), 端口, 好友数] × N */
function parseRangeSvrInfo(
  body: Buffer,
  excludedIds: readonly number[],
): GameServer[] {
  const reader = new BufferReader(body);
  const onlineCnt = reader.readUInt32();
  const servers: GameServer[] = [];

  for (let i = 0; i < onlineCnt; i++) {
    if (reader.remaining() < SERVER_RECORD_SIZE) {
      console.error(
        `cmd 106 响应在第 ${i + 1}/${onlineCnt} 条记录处截断，已解析 ${servers.length} 条`,
      );
      break;
    }

    const onlineID = reader.readUInt32();
    reader.skip(4); // 人数
    const ip = reader.readString(IP_FIELD_SIZE);
    const port = reader.readUInt16();
    reader.skip(4); // 好友数

    if (onlineID <= 0 || excludedIds.includes(onlineID)) continue;

    servers.push({ onlineID, ip, port });
  }

  return servers;
}
