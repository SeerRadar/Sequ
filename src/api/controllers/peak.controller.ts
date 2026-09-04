import { tcpService } from '../../game/client.js';
import { buildPacket } from '../../game/packet/builder.js';
import { parseRankList } from '../../game/packet/parser.js';
import { BufferReader } from '../../game/packet/reader.js';
import { badRequest, fail, notFound, success } from '../helpers/reply.js';
import type { ReplyPayload } from '../helpers/reply.js';
import { isValidPagination } from '../helpers/validate.js';
import type { Context } from 'hono';

type VoteItem = {
  voteMonsterId: number;
  voteCount: number;
};

function parseVoteList(voteResult: Buffer): VoteItem[] {
  const reader = new BufferReader(voteResult);
  const voteListLen = reader.readUInt32();
  const voteList: VoteItem[] = [];

  for (let i = 0; i < voteListLen; i++) {
    voteList.push({
      voteMonsterId: reader.readUInt32(),
      voteCount: reader.readUInt32(),
    });
    reader.skip(16);
  }

  return voteList;
}

/**
 * 巅峰圣战排行榜 key 矩阵：page → mode 行 → tab 列
 *
 * - page 1（玩家排行）：仅胜场，按 mode 区分竞技/狂野/专家/大师
 * - page 2（精灵排行）：tab 0/1/2 = 胜场 / 出场次数 / 禁止次数
 * - page 3（套装排行）：tab 0/1 = 胜场 / 出场次数
 * - page 4（称号排行）：tab 0/1 = 胜场 / 出场次数
 *
 * @example
 * PEAK_RANK_KEYS[1][0][0] // 120（玩家排行·竞技）
 * PEAK_RANK_KEYS[2][0][1] // 93（精灵排行·竞技·出场次数）
 * PEAK_RANK_KEYS[3][1][0] // 187（套装排行·狂野·胜场）
 * PEAK_RANK_KEYS[4][2][1] // 205（称号排行·专家·出场次数）
 * PEAK_RANK_KEYS[1][3][0] // 256（玩家排行·大师）
 */
const PEAK_RANK_KEYS: Record<number, number[][]> = {
  1: [[120], [182], [199], [256]],
  2: [
    [177, 93, 94],
    [185, 184, 183],
    [202, 201, 200],
    [259, 258, 257],
  ],
  3: [
    [174, 173],
    [187, 186],
    [204, 203],
    [261, 260],
  ],
  4: [
    [176, 175],
    [189, 188],
    [206, 205],
    [263, 262],
  ],
};

/** 非法组合（越界的 mode / tab / page）返回 NaN */
function getPeakRankKey(page: number, mode: number, tab: number): number {
  return PEAK_RANK_KEYS[page]?.[mode]?.[tab] ?? NaN;
}

// 获取投票信息 voteType: 0 限制级；1 准限制级
async function fetchVoteInfo(
  voteDate: number,
  voteType: number,
  startIdx: number,
  endIdx: number,
): Promise<ReplyPayload> {
  try {
    const pkt = buildPacket(4481, 191 + voteType, voteDate, startIdx, endIdx);
    const voteResult = await tcpService.sendAndReceive(pkt);

    if (voteResult && voteResult.length > 0) {
      return success({ voteList: parseVoteList(voteResult) }, '获取成功');
    }

    return notFound('数据返回失败', { error: '该投票日期的信息不存在' });
  } catch (error) {
    return fail('数据返回失败', { error: (error as Error).message }, 500);
  }
}

export async function getVoteInfo(c: Context): Promise<Response> {
  const voteDate = Number(c.req.query('voteDate'));
  const voteType = Number(c.req.query('voteType')) === 1 ? 1 : 0;
  const startIdx = Number(c.req.query('startIdx') ?? 0);
  const endIdx = Number(c.req.query('endIdx') ?? 25);

  if (!Number.isFinite(voteDate) || voteDate <= 0) {
    return c.json(
      badRequest('数据返回失败', { error: '请输入有效的投票日期' }),
    );
  }

  if (!isValidPagination(startIdx, endIdx)) {
    return c.json(
      badRequest('数据返回失败', { error: '请输入有效的分页参数' }),
    );
  }

  return c.json(await fetchVoteInfo(voteDate, voteType, startIdx, endIdx));
}

async function fetchPeakRank(
  key: number,
  subkey: number,
  startIdx: number,
  endIdx: number,
): Promise<ReplyPayload> {
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

// 获取巅峰排行信息
export async function getPeakRankInfo(c: Context): Promise<Response> {
  const keyParam = Number(c.req.query('key'));
  const page = Number(c.req.query('page'));
  const mode = Number(c.req.query('mode') ?? 0);
  const tab = Number(c.req.query('tab') ?? 0);
  const subkey = Number(c.req.query('subkey'));
  const startIdx = Number(c.req.query('startIdx') ?? 0);
  const endIdx = Number(c.req.query('endIdx') ?? 99);

  let key = keyParam;

  if (!Number.isFinite(key) || key <= 0) {
    key = getPeakRankKey(page, mode, tab);
  }

  if (!Number.isFinite(key)) {
    return c.json(badRequest('数据返回失败', { error: '无效的排行榜类型' }));
  }

  if (!Number.isFinite(subkey) || subkey < 0) {
    return c.json(
      badRequest('数据返回失败', { error: '请输入有效的排行参数' }),
    );
  }

  if (!isValidPagination(startIdx, endIdx)) {
    return c.json(
      badRequest('数据返回失败', { error: '请输入有效的分页参数' }),
    );
  }

  return c.json(await fetchPeakRank(key, subkey, startIdx, endIdx));
}
