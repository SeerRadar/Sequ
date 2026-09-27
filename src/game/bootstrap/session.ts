import { DEVICE_PLATFORM_NAME } from '../device.js';
import { PacketBuilder } from '../packet/builder.js';
import {
  CMD_FORBID_CHECK,
  CMD_MAIN_LOGIN_IN,
  CMD_SYS_ROLE,
  RESULT_ERROR_THRESHOLD,
  parsePacket,
} from '../packet/protocol.js';
import type { RegionProfile } from '../region.js';
import { requestOnce } from '../transport/rawRequest.js';
import { withGate } from './gate.js';
import axios from 'axios';
import crypto from 'crypto';
import type net from 'net';

const SESSION_SERVER_URL = 'https://account-co.61.com/index.php';
const SESSION_TIMEOUT_MS = 10000;

const JSONP_SUFFIX = ');';

const SESSION_SIZE = 16;
/** session 以十六进制串下发，字符数为字节数的两倍 */
const SESSION_HEX_PATTERN = new RegExp(`^[0-9a-f]{${SESSION_SIZE * 2}}$`, 'i');
/** cmd 103 的密码字段定长 32 字节，内容为双重 MD5 的十六进制串 */
const PASSWORD_FIELD_SIZE = 32;
/** cmd 103 为图形验证码预留的编号与答案槽位 */
const IGM_ID_SIZE = 16;
const IMG_BY_SIZE = 6;
const TMCID_SIZE = 64;
const DEVICE_FIELD_SIZE = 16;

const GAME_ID = 2;
const CHANNEL_ID = 1;

const MAIN_LOGIN_STATUS = {
  Success: 0,
  WrongPassword: 1,
  NeedVerification: 2,
} as const;

/**
 * 获取登录 session，cmd 1001 进服时需要携带。
 *
 * 两服账号体系接口不同：
 * - 大陆服有 HTTP 账号接口，可直接换取 session
 * - 台服账号站点是 SPA，没有对应 HTTP 接口，只能在登录网关走 cmd 103
 */
export async function acquireSession(
  profile: RegionProfile,
  account: number,
  password: string,
): Promise<Buffer> {
  if (profile.id === 'cn') {
    return fetchSessionFromAccountApi(account, password);
  }
  return fetchSessionFromLoginGate(profile, account, password);
}

async function fetchSessionFromAccountApi(
  account: number,
  password: string,
): Promise<Buffer> {
  const md5Hash = crypto.createHash('md5').update(password).digest('hex');
  const timestamp = Date.now().toString();
  const callback = `jQuery19008830978978300397_${timestamp}`;

  const params = {
    r: 'userIdentity/authenticate',
    callback,
    account: account.toString(),
    rememberAcc: 'false',
    passwd: md5Hash,
    rememberPwd: 'true',
    vericode: '',
    game: '02',
    tad: 'none',
    _: timestamp,
  };

  const response = await axios.get<string>(SESSION_SERVER_URL, {
    params,
    responseType: 'text',
    timeout: SESSION_TIMEOUT_MS,
  });

  const payload = parseJsonp(response.data.trim(), callback);

  if (payload.result !== 0) {
    const errMsg = payload.err_desc || JSON.stringify(payload);
    throw new Error(`登录失败: ${errMsg}`);
  }

  const session = payload.data?.session;
  if (!session) {
    throw new Error('响应中缺少 session');
  }

  if (!SESSION_HEX_PATTERN.test(session)) {
    throw new Error(`session 格式错误: ${session}`);
  }

  return Buffer.from(session, 'hex');
}

interface AccountAuthPayload {
  result: number;
  err_desc?: string;
  data?: { session?: string };
}

function parseJsonp(
  responseText: string,
  expectedCallback: string,
): AccountAuthPayload {
  if (!responseText.endsWith(JSONP_SUFFIX)) {
    throw new Error('回调格式不正确');
  }

  const openParen = responseText.indexOf('(');
  if (openParen === -1) {
    throw new Error('响应缺少括号');
  }

  // jQuery 会在回调名后追加随机后缀，故按前缀比对
  const actualCallback = responseText.substring(0, openParen);
  if (!actualCallback.startsWith(expectedCallback)) {
    throw new Error(`回调名称不匹配: ${actualCallback}`);
  }

  const jsonText = responseText.substring(
    openParen + 1,
    responseText.length - JSONP_SUFFIX.length,
  );
  return JSON.parse(jsonText) as AccountAuthPayload;
}

/**
 * 台服：登录网关 cmd 103 MAIN_LOGIN_IN。
 *
 * 参数顺序与定长取自台服客户端 LoginManager.login；除换取 session 外，还按客户端流程
 * 补发 cmd 111 封禁校验与 cmd 109 角色校验。客户端同样在进服前销毁登录连接，
 * 故这条连接用完即关（见 OnlineManager.onSocketConnect）。
 */
async function fetchSessionFromLoginGate(
  profile: RegionProfile,
  account: number,
  password: string,
): Promise<Buffer> {
  return withGate(profile, async (socket) => {
    const builder = new PacketBuilder()
      .setCmdId(CMD_MAIN_LOGIN_IN)
      .setUserId(account)
      .addBytes(Buffer.alloc(0))
      .addFixedString(doubleMd5(password), PASSWORD_FIELD_SIZE)
      .addU32(0)
      .addU32(GAME_ID)
      .addU32(0)
      .addBytes(Buffer.alloc(IGM_ID_SIZE))
      .addBytes(Buffer.alloc(IMG_BY_SIZE))
      .addBytes(Buffer.alloc(TMCID_SIZE))
      .addU32(CHANNEL_ID)
      .addFixedString(DEVICE_PLATFORM_NAME, DEVICE_FIELD_SIZE);

    const response = await requestOnce(
      socket,
      Buffer.from(builder.build(), 'hex'),
    );

    const session = parseMainLoginResponse(response);

    await checkForbid(socket, account);
    await checkSysRole(socket, account, session);

    return session;
  });
}

function parseMainLoginResponse(response: Buffer): Buffer {
  const parsed = parsePacket(response);
  if (!parsed) {
    throw new Error('cmd 103 响应解析失败');
  }

  if (parsed.result > RESULT_ERROR_THRESHOLD) {
    throw new Error(`登录失败 (result=${parsed.result})`);
  }

  if (parsed.body.length < 4 + SESSION_SIZE) {
    throw new Error('响应长度不足，缺少 session');
  }

  const status = parsed.body.readInt32BE(0);

  if (status === MAIN_LOGIN_STATUS.WrongPassword) {
    throw new Error('账号或密码错误');
  }
  if (status === MAIN_LOGIN_STATUS.NeedVerification) {
    throw new Error('登录需要图形验证码，暂不支持自动处理');
  }
  if (status !== MAIN_LOGIN_STATUS.Success) {
    throw new Error(`登录失败 (status=${status})`);
  }

  // 状态码之后即 16 字节 session
  return Buffer.from(parsed.body.subarray(4, 4 + SESSION_SIZE));
}

/** cmd 111 封禁校验：响应体首部为封禁截止时间戳，0 表示未封禁 */
async function checkForbid(socket: net.Socket, account: number): Promise<void> {
  const builder = new PacketBuilder()
    .setCmdId(CMD_FORBID_CHECK)
    .setUserId(account);

  const response = await requestOnce(
    socket,
    Buffer.from(builder.build(), 'hex'),
  );

  const parsed = parsePacket(response);
  if (!parsed || parsed.body.length < 4) return;

  const banUntil = parsed.body.readUInt32BE(0);
  if (banUntil > 0) {
    throw new Error(`账号已被封禁 (解封时间戳 ${banUntil})`);
  }
}

/** cmd 109 角色校验，参数为 [session, 0] */
async function checkSysRole(
  socket: net.Socket,
  account: number,
  session: Buffer,
): Promise<void> {
  const builder = new PacketBuilder()
    .setCmdId(CMD_SYS_ROLE)
    .setUserId(account)
    .addBytes(session)
    .addU32(0);

  const response = await requestOnce(
    socket,
    Buffer.from(builder.build(), 'hex'),
  );

  if (!parsePacket(response)) {
    throw new Error('cmd 109 响应解析失败');
  }
}

function doubleMd5(password: string): string {
  const first = crypto.createHash('md5').update(password).digest('hex');
  return crypto.createHash('md5').update(first).digest('hex');
}
