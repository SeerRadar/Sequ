import { tcpService } from '../../game/client.js';
import { buildPacket } from '../../game/packet/builder.js';
import { parseRankList } from '../../game/packet/parser.js';
import { badRequest, fail, notFound, success } from '../helpers/reply.js';
import type { ReplyPayload } from '../helpers/reply.js';
import { isValidPagination } from '../helpers/validate.js';
import type { Context } from 'hono';

/** 排行类型(type) → 游戏排行 (key, subkey) */
const RANK_TYPES: Record<number, { key: number; subkey: number }> = {
  0: { key: 156, subkey: 1 }, // 图鉴
  1: { key: 17, subkey: 0 }, // 成就
  2: { key: 159, subkey: 1 }, // 刻印
  3: { key: 158, subkey: 1 }, // 精灵
  4: { key: 161, subkey: 1 }, // 皮肤
  5: { key: 160, subkey: 1 }, // 装扮A
  6: { key: 160, subkey: 2 }, // 装扮B
  7: { key: 160, subkey: 3 }, // 座驾
};

async function getNormalRankInfo({
  key,
  subkey,
  startIdx = 0,
  endIdx = 99,
}: {
  key: number;
  subkey: number;
  startIdx?: number;
  endIdx?: number;
}): Promise<ReplyPayload> {
  if (!isValidPagination(startIdx, endIdx)) {
    return badRequest('数据返回失败', { error: '请输入有效的分页参数' });
  }

  try {
    const pkt = buildPacket(4481, key, subkey, startIdx, endIdx);

    const result = await tcpService.sendAndReceive(pkt);

    if (result && result.length > 0) {
      return success(
        { key, subkey, startIdx, endIdx, rankList: parseRankList(result) },
        '获取成功',
      );
    }

    return notFound('数据返回失败', { error: '该排行信息不存在' });
  } catch (error) {
    return fail('数据返回失败', { error: (error as Error).message });
  }
}

export const getBookAndAchieveRankInfo = async (
  c: Context,
): Promise<Response> => {
  const startIdx = c.req.query('startIdx') ?? 0;
  const endIdx = c.req.query('endIdx') ?? 99;
  const typeNum = Number(c.req.query('type'));

  if (!Number.isFinite(typeNum) || typeNum < 0) {
    return c.json(
      badRequest('数据返回失败', { error: '请输入有效的排行榜类型' }),
    );
  }

  const rankType = RANK_TYPES[typeNum];
  if (!rankType) {
    return c.json(badRequest('数据返回失败', { error: '排行榜类型不存在' }));
  }

  const replyPayload = await getNormalRankInfo({
    key: rankType.key,
    subkey: rankType.subkey,
    startIdx: Number(startIdx),
    endIdx: Number(endIdx),
  });
  return c.json(replyPayload);
};

export const getAutoCardRankInfo = async (c: Context): Promise<Response> => {
  const startIdx = c.req.query('startIdx') ?? 0;
  const endIdx = c.req.query('endIdx') ?? 99;

  const replyPayload = await getNormalRankInfo({
    key: 240,
    subkey: 1,
    startIdx: Number(startIdx),
    endIdx: Number(endIdx),
  });
  return c.json(replyPayload);
};

export const getXuanWuRankInfo = async (c: Context): Promise<Response> => {
  const startIdx = c.req.query('startIdx') ?? 0;
  const endIdx = c.req.query('endIdx') ?? 99;

  const replyPayload = await getNormalRankInfo({
    key: 267,
    subkey: 1,
    startIdx: Number(startIdx),
    endIdx: Number(endIdx),
  });
  return c.json(replyPayload);
};
