import { tcpService } from '../../game/client.js';
import { buildPacket } from '../../game/packet/builder.js';
import { toHexStr } from '../../game/packet/format.js';
import { BufferReader } from '../../game/packet/reader.js';
import { badRequest, fail, notFound, success } from '../helpers/reply.js';
import type { ReplyPayload } from '../helpers/reply.js';
import { getInvalidAccountRes, isValidAccount } from '../helpers/validate.js';
import type { Context } from 'hono';

interface NicknameResult {
  success: boolean;
  nickName?: string;
  hexData?: string;
}

const NICKNAME_MIN_LENGTH = 39;
const ONLINE_STATUS_MIN_LENGTH = 12;

const PetUseFlag = {
  Battle: 1,
  FirstBag: 2,
  SecondBag: 7,
} as const;

const PEAK_PARAMS = [
  124801,
  124802,
  124804,
  124805, // 竞技
  124791,
  124792,
  124793,
  124794, // 狂野
  129441,
  129443,
  129446,
  129447, // 专家
];

const PEAK_QUERY_DELAY_MS = 5;

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

async function sendPacketAndToHex(
  cmdId: number,
  ...params: number[]
): Promise<string> {
  const packet = buildPacket(cmdId, ...params);
  return toHexStr(await tcpService.sendAndReceive(packet));
}

async function fetchNickname(account: number): Promise<NicknameResult> {
  const pkt = buildPacket(2052, account);
  const res = await tcpService.sendAndReceive(pkt);
  if (!res || res.length <= NICKNAME_MIN_LENGTH) return { success: false };
  const reader = new BufferReader(res);
  reader.skip(4);
  return {
    success: true,
    nickName: reader.readString(16),
    hexData: toHexStr(res),
  };
}

interface OnlineResult {
  online: boolean;
  server?: string;
}

async function fetchOnlineStatus(account: number): Promise<OnlineResult> {
  const pkt = buildPacket(2157, 1, account);
  const res = await tcpService.sendAndReceive(pkt);
  if (!res || res.length < ONLINE_STATUS_MIN_LENGTH) return { online: false };
  const reader = new BufferReader(res);
  const isOnline = reader.readUInt32() === 1;
  reader.skip(4);
  const server = String(reader.readUInt32());
  return { online: isOnline, ...(isOnline ? { server } : {}) };
}

interface PetInfo {
  catchTime: number;
  useFlag: number;
  petId: number;
  level: number;
  dv?: number;
  nature?: number;
  hp?: number;
  maxHp?: number;
  maxhpAdj?: number;
  atk?: number;
  atkAdj?: number;
  spAtk?: number;
  spatkAdj?: number;
  def?: number;
  defAdj?: number;
  spDef?: number;
  spdefAdj?: number;
  spd?: number;
  spdAdj?: number;
  evlist?: number[];
  skills?: { id: number; pp: number }[];
  activatedSpMoves?: number[];
  mintmarks?: number[];
  commonSlotActivated?: number;
  skinId?: number;
}

interface UserPublicPetInfoResult {
  petCount: number;
  firstBagPets: PetInfo[];
  secondBagPets: PetInfo[];
  hexData: string;
}

function stripPetInfo({ catchTime, useFlag, petId, level }: PetInfo): PetInfo {
  return { catchTime, useFlag, petId, level };
}

function readFullPetInfo(reader: BufferReader): PetInfo {
  const catchTime = reader.readUInt32();
  const useFlag = reader.readUInt32();
  const petId = reader.readUInt32();
  const level = reader.readUInt32();
  const dv = reader.readUInt32();
  const nature = reader.readUInt32();
  const hp = reader.readUInt32();
  const maxHp = reader.readUInt32();
  const maxhpAdj = reader.readUInt32();
  const atk = reader.readUInt32();
  const atkAdj = reader.readUInt32();
  const spAtk = reader.readUInt32();
  const spatkAdj = reader.readUInt32();
  const def = reader.readUInt32();
  const defAdj = reader.readUInt32();
  const spDef = reader.readUInt32();
  const spdefAdj = reader.readUInt32();
  const spd = reader.readUInt32();
  const spdAdj = reader.readUInt32();
  const evlist: number[] = [];
  for (let j = 0; j < 6; j++) {
    evlist.push(reader.readUInt8());
  }
  const skillCount = reader.readUInt32();
  const skills: { id: number; pp: number }[] = [];
  for (let j = 0; j < 5; j++) {
    const id = reader.readUInt32();
    const pp = reader.readUInt32();
    if (j < skillCount) {
      skills.push({ id, pp });
    }
  }
  const activatedSpMoves: number[] = [];
  for (let j = 0; j < 6; j++) {
    activatedSpMoves.push(reader.readUInt32());
  }
  const mintmarks: number[] = [];
  for (let j = 0; j < 3; j++) {
    mintmarks.push(reader.readUInt32());
  }
  const commonSlotActivated = reader.readUInt32();
  const skinId = reader.readUInt32();

  return {
    catchTime,
    useFlag,
    petId,
    level,
    dv,
    nature,
    hp,
    maxHp,
    maxhpAdj,
    atk,
    atkAdj,
    spAtk,
    spatkAdj,
    def,
    defAdj,
    spDef,
    spdefAdj,
    spd,
    spdAdj,
    evlist,
    skills,
    activatedSpMoves,
    mintmarks,
    commonSlotActivated,
    skinId,
  };
}

async function fetchUserPublicPetInfo(
  userId: number,
  fullInfo = false,
): Promise<UserPublicPetInfoResult> {
  const pkt = buildPacket(41635, userId);
  const res = await tcpService.sendAndReceive(pkt);
  if (!res || res.length <= 0)
    return { petCount: 0, firstBagPets: [], secondBagPets: [], hexData: '' };
  const reader = new BufferReader(res);
  const petCount = reader.readUInt32();
  reader.readUInt32();
  if (petCount === 0)
    return { petCount: 0, firstBagPets: [], secondBagPets: [], hexData: '' };

  const firstBagPets: PetInfo[] = [];
  const secondBagPets: PetInfo[] = [];

  for (let i = 0; i < petCount; i++) {
    const pet = readFullPetInfo(reader);

    if (
      pet.useFlag === PetUseFlag.Battle ||
      pet.useFlag === PetUseFlag.FirstBag
    ) {
      firstBagPets.push(pet);
    } else if (pet.useFlag === PetUseFlag.SecondBag) {
      secondBagPets.push(pet);
    }
  }

  const totalCount = firstBagPets.length + secondBagPets.length;
  return {
    petCount: totalCount,
    firstBagPets: fullInfo ? firstBagPets : firstBagPets.map(stripPetInfo),
    secondBagPets: fullInfo ? secondBagPets : secondBagPets.map(stripPetInfo),
    hexData: toHexStr(res),
  };
}

function accountErrorData(account: number) {
  return { account: String(account), error: '该米米号的信息不存在' };
}

// ---------- fetch: 组装查询并返回统一响应 ----------

async function fetchUserOnlineStatus(account: number): Promise<ReplyPayload> {
  try {
    const nicknameResult = await fetchNickname(account);
    if (!nicknameResult.success) {
      return notFound('数据返回失败', accountErrorData(account));
    }

    const onlineResult = await fetchOnlineStatus(account);

    return success(
      {
        account: String(account),
        nickName: nicknameResult.nickName,
        ...onlineResult,
      },
      '数据返回成功',
    );
  } catch (error) {
    return fail('数据返回失败', {
      account: String(account),
      error: (error as Error).message,
    });
  }
}

async function fetchUserInfo(account: number): Promise<ReplyPayload> {
  try {
    // 验证账号是否存在
    const nicknameResult = await fetchNickname(account);
    if (!nicknameResult.success) {
      return notFound('数据返回失败', accountErrorData(account), { status: 1 });
    }

    // 获取在线状态和简单信息
    const [onlineResult, hexDataSimple] = await Promise.all([
      fetchOnlineStatus(account),
      sendPacketAndToHex(2051, account),
    ]);

    // 成就/精灵信息
    const [hexDatapart1, hexDatapart2] = await Promise.all([
      sendPacketAndToHex(41298, 1, account, 0, 0),
      sendPacketAndToHex(41298, 5, account, 0, 0),
    ]);

    let hexDataPeak = '';
    for (const param of PEAK_PARAMS) {
      hexDataPeak += await sendPacketAndToHex(40002, account, param);
      await sleep(PEAK_QUERY_DELAY_MS);
    }

    const { hexData: hexDataPublicPetInfo } =
      await fetchUserPublicPetInfo(account);

    return success(
      {
        account: String(account),
        nickName: nicknameResult.nickName,
        hexDataMore: nicknameResult.hexData,
        ...onlineResult,
        hexDataSimple,
        hexDatapart1,
        hexDatapart2,
        hexDataPeak,
        hexDataPublicPetInfo,
      },
      '数据返回成功',
      200,
      { status: 1 },
    );
  } catch (error) {
    return fail(
      '数据返回失败',
      { account: String(account), error: (error as Error).message },
      500,
      { status: 1 },
    );
  }
}

async function fetchTeamInfo(teamId: number): Promise<ReplyPayload> {
  try {
    const pkt = buildPacket(2917, teamId);
    const result = await tcpService.sendAndReceive(pkt);

    if (result && result.length > 0) {
      return success(
        { teamId: String(teamId), hexDataTeam: toHexStr(result) },
        '获取成功',
      );
    }

    return notFound('数据返回失败', { error: '该战队号的信息不存在' });
  } catch (error) {
    return fail('数据返回失败', { error: (error as Error).message });
  }
}

async function fetchUserBagPetInfo(
  userId: number,
  full: boolean,
): Promise<ReplyPayload> {
  try {
    const { petCount, firstBagPets, secondBagPets } =
      await fetchUserPublicPetInfo(userId, full);

    if (petCount === 0) {
      return notFound('数据返回失败', { error: '该玩家的背包精灵信息不存在' });
    }

    return success(
      {
        userId: String(userId),
        petCount,
        firstBagPetsCount: firstBagPets.length,
        secondBagPetsCount: secondBagPets.length,
        firstBagPets,
        secondBagPets,
      },
      '获取成功',
    );
  } catch (error) {
    return fail('数据返回失败', { error: (error as Error).message });
  }
}

// ---------- handlers: 参数校验 + 响应 ----------

// 查询用户在线状态
export async function getUserOnlineStatus(c: Context): Promise<Response> {
  const account = Number(c.req.param('account'));

  if (!isValidAccount(account)) {
    const invalidAccountResponse = getInvalidAccountRes(account);
    return c.json(
      badRequest(invalidAccountResponse.message, invalidAccountResponse.data),
    );
  }

  return c.json(await fetchUserOnlineStatus(account));
}

// 获取米米号详细信息
export async function getUserInfo(c: Context): Promise<Response> {
  const account = Number(c.req.param('account'));

  if (!isValidAccount(account)) {
    const invalidAccountResponse = getInvalidAccountRes(account, true);
    return c.json(
      badRequest(invalidAccountResponse.message, invalidAccountResponse.data, {
        status: invalidAccountResponse.status,
      }),
    );
  }

  return c.json(await fetchUserInfo(account));
}

// 获取战队信息
export async function getTeamInfo(c: Context): Promise<Response> {
  const teamId = Number(c.req.param('teamId'));

  if (!teamId || isNaN(teamId) || teamId <= 0) {
    return c.json(badRequest('数据返回失败', { error: '请输入有效的战队ID' }));
  }

  return c.json(await fetchTeamInfo(teamId));
}

// 获取玩家背包精灵信息
export async function getUserBagPetInfo(c: Context): Promise<Response> {
  const userId = Number(c.req.param('userId'));
  const full = c.req.query('full') === 'true';

  if (!userId || isNaN(userId) || userId <= 0) {
    return c.json(badRequest('数据返回失败', { error: '请输入有效的玩家ID' }));
  }

  return c.json(await fetchUserBagPetInfo(userId, full));
}
