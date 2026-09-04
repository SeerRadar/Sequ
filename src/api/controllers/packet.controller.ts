import { tcpService } from '../../game/client.js';
import { PacketBuilder } from '../../game/packet/builder.js';
import { toHexStr } from '../../game/packet/format.js';
import { badRequest, fail, success } from '../helpers/reply.js';
import type { ReplyPayload } from '../helpers/reply.js';
import type { Context } from 'hono';

const MIN_TIMEOUT = 1000;
const MAX_TIMEOUT = 30000;

async function parseAndSend(body: {
  cmdId: number;
  userId?: number;
  params?: number[];
  bodyHex?: string;
  timeout?: number;
}): Promise<ReplyPayload> {
  try {
    const builder = new PacketBuilder()
      .setCmdId(body.cmdId)
      .setUserId(body.userId ?? 0);

    if (body.params && body.params.length > 0) {
      for (const param of body.params) {
        builder.addU32(param);
      }
    }

    if (body.bodyHex) {
      builder.addHex(body.bodyHex);
    }

    const pkt = builder.build();
    const result = await tcpService.sendAndReceive(pkt, body.timeout ?? 5000);

    if (result && result.length > 0) {
      return success({
        cmdId: body.cmdId,
        hexData: toHexStr(result),
      });
    }

    return success({
      cmdId: body.cmdId,
      hexData: '',
    });
  } catch (error) {
    return fail('发送失败', {
      cmdId: body.cmdId,
      error: (error as Error).message,
    });
  }
}

export const sendPacket = async (c: Context) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json(badRequest('请求体格式错误', { error: '无效的JSON' }));
  }

  const cmdId = body.cmdId;
  const userId = body.userId;
  const params = body.params;
  const bodyHex = body.bodyHex;
  const timeout = body.timeout;

  if (cmdId === undefined || cmdId === null) {
    return c.json(badRequest('参数错误', { error: 'cmdId 为必填字段' }));
  }

  const cmdIdNum = Number(cmdId);
  if (!Number.isFinite(cmdIdNum) || cmdIdNum <= 0) {
    return c.json(badRequest('参数错误', { error: 'cmdId 必须为正整数' }));
  }

  if (userId !== undefined && userId !== null) {
    const userIdNum = Number(userId);
    if (!Number.isFinite(userIdNum) || userIdNum < 0) {
      return c.json(badRequest('参数错误', { error: 'userId 必须为非负整数' }));
    }
  }

  if (params !== undefined) {
    if (!Array.isArray(params)) {
      return c.json(badRequest('参数错误', { error: 'params 必须为数组' }));
    }
    for (const p of params) {
      if (!Number.isFinite(Number(p))) {
        return c.json(
          badRequest('参数错误', { error: 'params 数组元素必须为数字' }),
        );
      }
    }
  }

  if (bodyHex !== undefined && typeof bodyHex !== 'string') {
    return c.json(badRequest('参数错误', { error: 'bodyHex 必须为字符串' }));
  }

  let timeoutNum = 5000;
  if (timeout !== undefined) {
    timeoutNum = Number(timeout);
    if (
      !Number.isFinite(timeoutNum) ||
      timeoutNum < MIN_TIMEOUT ||
      timeoutNum > MAX_TIMEOUT
    ) {
      return c.json(
        badRequest('参数错误', {
          error: `timeout 必须在 ${MIN_TIMEOUT}~${MAX_TIMEOUT} 之间`,
        }),
      );
    }
  }

  const replyPayload = await parseAndSend({
    cmdId: cmdIdNum,
    userId: userId !== undefined ? Number(userId) : undefined,
    params: params as number[] | undefined,
    bodyHex: bodyHex as string | undefined,
    timeout: timeoutNum,
  });
  return c.json(replyPayload);
};
