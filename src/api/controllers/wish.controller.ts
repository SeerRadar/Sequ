import { tcpService } from '../../game/client.js';
import { buildPacket } from '../../game/packet/builder.js';
import { BufferReader } from '../../game/packet/reader.js';
import { badRequest, fail, notFound, success } from '../helpers/reply.js';
import type { ReplyPayload } from '../helpers/reply.js';
import type { Context } from 'hono';

interface WishItemInfo {
  wishitemId: number;
  wishitemIsHave: number;
  wishitemCurProgress: number;
  wishitemMaxProgress: number;
  wishitemPrayPop: number[];
}

/** 周年庆许愿类型(type) → 查询命令 */
const WISH_TYPE_CMD: Record<number, number> = {
  0: 41416, // skin
  1: 41418, // suit
  2: 41420, // part
  3: 45891, // mintmark
};

async function fetchWishInfo(cmdId: number): Promise<ReplyPayload> {
  try {
    const pkt = buildPacket(cmdId);

    const result = await tcpService.sendAndReceive(pkt);

    if (result && result.length > 0) {
      const list: WishItemInfo[] = [];

      const reader = new BufferReader(result);
      const loopNum = reader.readUInt32();
      for (let i = 0; i < loopNum; i++) {
        const wishitemId = reader.readUInt32();
        const wishitemIsHave = reader.readUInt32();
        const wishitemCurProgress = reader.readUInt32();
        const wishitemMaxProgress = reader.readUInt32();
        const wishitemPrayPop: number[] = [];
        for (let j = 0; j < 5; j++) {
          wishitemPrayPop.push(reader.readUInt32());
        }
        list.push({
          wishitemId,
          wishitemIsHave,
          wishitemCurProgress,
          wishitemMaxProgress,
          wishitemPrayPop,
        });
      }
      return success({ list }, '获取成功');
    }

    return notFound('数据返回失败', { error: '该许愿信息不存在' });
  } catch (error) {
    return fail('数据返回失败', { error: (error as Error).message });
  }
}

export const getWishInfo = async (c: Context): Promise<Response> => {
  const typeNum = Number(c.req.query('type'));

  if (!Number.isFinite(typeNum) || typeNum < 0) {
    return c.json(
      badRequest('数据返回失败', { error: '请输入有效的周年庆许愿类型' }),
    );
  }

  const cmdId = WISH_TYPE_CMD[typeNum];
  if (cmdId === undefined) {
    return c.json(
      badRequest('数据返回失败', { error: '周年庆许愿类型不存在' }),
    );
  }

  return c.json(await fetchWishInfo(cmdId));
};
