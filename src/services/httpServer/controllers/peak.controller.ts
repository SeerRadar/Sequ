import { Request, Response } from "express";
import { tcpService } from "../../tcpService";
import { PacketBuilder } from "../../../utils/pkgBuilder";
import { BufferReader } from "../../../utils/reader";
import { badRequest, fail, notFound, success } from "../../../utils/reply";

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

// 获取投票信息 voteType: 0 限制级；1 准限制级
export async function getVoteInfo(req: Request, res: Response): Promise<void> {
  const voteDate = Number(req.query.voteDate);
  // 0 限制级；1 准限制级
  const voteType = Number(req.query.voteType) === 1 ? 1 : 0;
  const startIdx = Number(req.query.startIdx ?? 0);
  const endIdx = Number(req.query.endIdx ?? 25);

  if (!Number.isFinite(voteDate) || voteDate <= 0) {
    res.json(badRequest("数据返回失败", { error: "请输入有效的投票日期" }));
    return;
  }

  if (
    !Number.isFinite(startIdx) ||
    !Number.isFinite(endIdx) ||
    startIdx < 0 ||
    endIdx < startIdx
  ) {
    res.json(badRequest("数据返回失败", { error: "请输入有效的分页参数" }));
    return;
  }

  try {
    const pkt = new PacketBuilder()
      .setCmdId(4481)
      .addU32(191 + voteType)
      .addU32(voteDate)
      .addU32(startIdx)
      .addU32(endIdx)
      .build();
    const voteResult = await tcpService.sendAndReceive(4481, pkt);

    if (voteResult && voteResult.length > 0) {
      const voteList = parseVoteList(voteResult);
      res.json(success({ voteList }, "获取成功"));
      return;
    }

    res.json(notFound("数据返回失败", { error: "该投票日期的信息不存在" }));
  } catch (error) {
    res.json(fail("数据返回失败", { error: (error as Error).message }, 500));
  }
}
