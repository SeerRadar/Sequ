import {
  badRequest,
  fail,
  notFound,
  success,
} from '../../../utils/http/reply.js';
import type { ReplyPayload } from '../../../utils/http/reply.js';
import { buildPacket } from '../../../utils/pkg/builder.js';
import { BufferReader } from '../../../utils/pkg/reader.js';
import { tcpService } from '../../tcpService.js';
import type { Context } from 'hono';

interface WishItemInfo {
  wishitemId: number;
  wishitemIsHave: number;
  wishitemCurProgress: number;
  wishitemMaxProgress: number;
  wishitemPrayPop: number[];
}

async function parseWishInfo({
  cmdId,
}: {
  cmdId: number;
}): Promise<ReplyPayload> {
  try {
    const pkt = buildPacket(cmdId);

    const result = await tcpService.sendAndReceive(pkt);

    if (result && result.length > 0) {
      const list: WishItemInfo[] = [];

      const reader = new BufferReader(result!);
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
      return success(
        {
          list,
        },
        '获取成功',
      );
    }

    return notFound('数据返回失败', { error: '该排行信息不存在' });
  } catch (error) {
    return fail('数据返回失败', { error: (error as Error).message });
  }
}

export const getWishInfo = async (c: Context) => {
  const type = c.req.query('type');
  const typeNum = Number(type);

  if (!Number.isFinite(typeNum) || typeNum < 0) {
    return c.json(
      badRequest('数据返回失败', { error: '请输入有效的周年庆许愿类型' }),
    );
  }
  let cmdId: number;

  // 说明：精灵的配表在json里已经全了，只有skin, suit, mintmark得从收包解析 许愿需要的道具数量(不理解，为什么不在json里一起配了？)
  if (typeNum === 0) {
    // skin
    cmdId = 41416;
  } else if (typeNum === 1) {
    // suit
    cmdId = 41418;
  } else if (typeNum === 2) {
    // mintmark
    cmdId = 45891;
  } else {
    return c.json(
      badRequest('数据返回失败', { error: '周年庆许愿类型不存在' }),
    );
  }

  const replyPayload = await parseWishInfo({
    cmdId,
  });
  return c.json(replyPayload);
};
