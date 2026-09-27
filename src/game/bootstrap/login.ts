import type { Algorithms } from '../crypto.js';
import { DEVICE_PLATFORM_NAME } from '../device.js';
import { PacketBuilder } from '../packet/builder.js';
import { CMD_LOGIN_IN } from '../packet/protocol.js';
import type { RegionProfile } from '../region.js';
import { connectSocket } from './connect.js';
import { Svr } from './serverList.js';
import { acquireSession } from './session.js';
import type net from 'net';

const CONNECT_TIMEOUT_MS = 10000;

const SESSION_FIELD_SIZE = 16;
const TOP_LEFT_TMCID_SIZE = 64;
const DEVICE_FIELD_SIZE = 16;
const CHANNEL_BY_SIZE = 32;
const EXTRA_PKG_NAME_SIZE = 32;
const EXTRA_ID_SIZE = 64;

const PLATFORM_PC = 1;
const LOGIN_TYPE = 1;
const WEB_OR_APP = 2;

export class Login {
  constructor(
    private readonly profile: RegionProfile,
    private readonly algorithms: Algorithms,
  ) {}

  /** 登录游戏服并返回已发出 cmd 1001 的 socket */
  async login(account: number, password: string): Promise<net.Socket> {
    const session = await acquireSession(this.profile, account, password);
    console.log(`[${this.profile.id}] 获取 session 成功`);

    const svr = new Svr(this.profile);
    const svrInfo = await svr.getSvrInfo();
    console.log(
      `[${this.profile.id}] 选中服务器 onlineID=${svrInfo.onlineID} ${svrInfo.ip}:${svrInfo.port}`,
    );

    const socket = await connectSocket(
      svrInfo.ip,
      svrInfo.port,
      CONNECT_TIMEOUT_MS,
    );

    socket.write(this.buildLoginPacket(account, session, svrInfo.onlineID));

    return socket;
  }

  private buildLoginPacket(
    account: number,
    session: Buffer,
    onlineId: number,
  ): Buffer {
    const builder = new PacketBuilder()
      .setCmdId(CMD_LOGIN_IN)
      .setUserId(account)
      // 1. session
      .addFixedBytes(session, SESSION_FIELD_SIZE)
      // 2. topLeftTmcid：客户端填渠道名（tad）
      .addFixedString(this.profile.channel, TOP_LEFT_TMCID_SIZE)
      // 3. onlineID
      .addU32(onlineId)
      // 4. 固定值 1
      .addU32(1)
      // 5. device
      .addFixedString('PC', DEVICE_FIELD_SIZE)
      // 6. versionCode
      .addU32(this.profile.versionCode)
      // 7. loginType
      .addU32(LOGIN_TYPE)
      // 8. platform
      .addU32(PLATFORM_PC)
      // 9. webOrApp
      .addU32(WEB_OR_APP)
      // 10. channelBy
      .addFixedString(`unity_app_${this.profile.channel}`, CHANNEL_BY_SIZE)
      // 11. extra_pkg_name
      .addFixedString(this.profile.packageName, EXTRA_PKG_NAME_SIZE)
      // 12. extra_idfa_oaid
      .addBytes(Buffer.alloc(EXTRA_ID_SIZE))
      // 13. extra_idfv_imei
      .addBytes(Buffer.alloc(EXTRA_ID_SIZE))
      // 14. extra_caid_androidid
      .addBytes(Buffer.alloc(EXTRA_ID_SIZE))
      // 15. extra_devicetype
      .addFixedString(DEVICE_PLATFORM_NAME, EXTRA_ID_SIZE)
      // 16. extra_deviceid
      .addBytes(Buffer.alloc(EXTRA_ID_SIZE))
      // 17. extra_asa_token：长度前缀为 0
      .addU32(0);

    const result = this.algorithms.calculateResult(
      CMD_LOGIN_IN,
      builder.bodyBuffer(),
    );

    return Buffer.from(builder.setResult(result).build(), 'hex');
  }
}
