import { tcpService } from '../../game/client.js';
import { buildPacket } from '../../game/packet/builder.js';
import { BufferReader } from '../../game/packet/reader.js';
import { fail, notFound, success } from '../helpers/reply.js';
import type { ReplyPayload } from '../helpers/reply.js';
import type { Context } from 'hono';

interface PeakHistoryRecord {
  videoName: string;
  mode: number;
  totalTurn: number;
  finishTm: number;
  winUid: number;
  meUid: number;
  foeUid: number;
  meBfRank: number;
  meBfScore: number;
  meAfRank: number;
  meAfScore: number;
  meTitleId: number;
  mePartIds: number[];
  foeBfRank: number;
  foeBfScore: number;
  foeAfRank: number;
  foeAfScore: number;
  foeTitleId: number;
  foePartIds: number[];
  meBanInfos: number[];
  mePickInfos: number[];
  foeBanInfos: number[];
  foePickInfos: number[];
}

function readIntList(reader: BufferReader): number[] {
  const count = reader.readUInt32();
  const list: number[] = [];
  for (let i = 0; i < count; i++) {
    list.push(reader.readUInt32());
  }
  return list;
}

function parsePeakHistoryRecord(reader: BufferReader): PeakHistoryRecord {
  const videoName = reader.readString(50);
  const mode = reader.readUInt32();
  const totalTurn = reader.readUInt32();
  const finishTm = reader.readUInt32();
  const winUid = reader.readUInt32();
  const meUid = reader.readUInt32();
  const foeUid = reader.readUInt32();
  const meBfRank = reader.readUInt32();
  const meBfScore = reader.readUInt32();
  const meAfRank = reader.readUInt32();
  const meAfScore = reader.readUInt32();
  const meTitleId = reader.readUInt32();

  const mePartIds: number[] = [];
  for (let i = 0; i < 5; i++) {
    mePartIds.push(reader.readUInt32());
  }

  const foeBfRank = reader.readUInt32();
  const foeBfScore = reader.readUInt32();
  const foeAfRank = reader.readUInt32();
  const foeAfScore = reader.readUInt32();
  const foeTitleId = reader.readUInt32();

  const foePartIds: number[] = [];
  for (let i = 0; i < 5; i++) {
    foePartIds.push(reader.readUInt32());
  }

  const meBanInfos = readIntList(reader);
  const mePickInfos = readIntList(reader);
  const foeBanInfos = readIntList(reader);
  const foePickInfos = readIntList(reader);

  return {
    videoName,
    mode,
    totalTurn,
    finishTm,
    winUid,
    meUid,
    foeUid,
    meBfRank,
    meBfScore,
    meAfRank,
    meAfScore,
    meTitleId,
    mePartIds,
    foeBfRank,
    foeBfScore,
    foeAfRank,
    foeAfScore,
    foeTitleId,
    foePartIds,
    meBanInfos,
    mePickInfos,
    foeBanInfos,
    foePickInfos,
  };
}

async function fetchPeakHistory(): Promise<ReplyPayload> {
  try {
    const pkt = buildPacket(41313);
    const result = await tcpService.sendAndReceive(pkt);

    if (result && result.length > 0) {
      const reader = new BufferReader(result);
      const count = reader.readUInt32();
      const recordList: PeakHistoryRecord[] = [];

      for (let i = 0; i < count; i++) {
        recordList.push(parsePeakHistoryRecord(reader));
      }

      return success({ recordList }, '获取成功');
    }

    return notFound('数据返回失败', { error: '该巅峰历史记录不存在' });
  } catch (error) {
    return fail('数据返回失败', { error: (error as Error).message });
  }
}

export const getPeakHistoryRecords = async (c: Context): Promise<Response> => {
  const replyPayload = await fetchPeakHistory();
  return c.json(replyPayload);
};
