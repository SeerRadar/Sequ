/**
 * 区域（大区）档案，纯数据表，不读环境变量。
 *
 * 大陆服与台服共用同一套封包格式、命令字典与 result 序列号算法，
 * 差异集中在：登录网关地址、session 获取方式、服务器 ID 段与公告地址。
 * 渠道相关常量两服取值相同，仍按区域列出以便后续调整。
 *
 * 环境变量覆盖（GAME_SERVER_HOST / GAME_SERVER_PORT）由 config 组装，
 * 调用方一律读 settings.regionProfile。
 */

export type RegionId = 'cn' | 'tw';

export interface GateAddress {
  ip: string;
  port: number;
}

export interface GameServer extends GateAddress {
  onlineID: number;
}

export interface RegionProfile {
  id: RegionId;
  label: string;
  /** 登录网关地址列表，响应形如 `ip:port|ip:port` */
  gateUrl: string;
  /** 网关地址列表获取失败时的兜底 */
  defaultGate: GateAddress;
  /** cmd 106 枚举服务器的 ID 区间（闭区间） */
  serverScanRange: readonly [number, number];
  /** 需要从服务器列表中剔除的 ID，都在扫描区间外，仅在服务端返回区间外记录时才会命中 */
  excludedServerIds: readonly number[];
  /** 服务器列表为空时的兜底目标 */
  defaultServer: GameServer;
  /** 渠道标识，同时用于 cmd 1001 的 topLeftTmcid 与 channelBy 后缀 */
  channel: string;
  /** cmd 1001 的 extra_pkg_name */
  packageName: string;
  /** cmd 1001 的 versionCode */
  versionCode: number;
  noticeUrl: string;
}

/** 客户端 LoginManager.testServerIdList，测试服 ID，两服共用同一份 */
const TEST_SERVER_IDS: readonly number[] = [
  1990, 1991, 2370, 2711, 3500, 2712, 2713, 2714,
];

export const PROFILES: Record<RegionId, RegionProfile> = {
  cn: {
    id: 'cn',
    label: '大陆服',
    gateUrl: 'https://seer-login-ip.61.com/unity-ip.txt',
    defaultGate: { ip: '175.24.235.221', port: 1864 },
    serverScanRange: [1800, 1900],
    excludedServerIds: TEST_SERVER_IDS,
    defaultServer: { onlineID: 2200, ip: '175.24.235.221', port: 1225 },
    channel: 'taomee',
    packageName: 'com.taomee.seer.mobile',
    versionCode: 10000,
    noticeUrl: 'http://unity-notice.61.com/unity_notice/',
  },
  tw: {
    id: 'tw',
    label: '台服',
    gateUrl: 'https://seerdf.61.com.tw/unity_login.txt',
    defaultGate: { ip: '35.221.253.34', port: 1877 },
    // 台服正式服分布在 1701~1789
    serverScanRange: [1700, 1799],
    excludedServerIds: TEST_SERVER_IDS,
    defaultServer: { onlineID: 1701, ip: '35.221.253.34', port: 1201 },
    channel: 'taomee',
    packageName: 'com.taomee.seer.mobile',
    versionCode: 10000,
    noticeUrl: 'http://seerdf-notice.61.com.tw/seer_announcement.json',
  },
};
