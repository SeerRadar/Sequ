import { PROFILES } from '../game/region.js';
import type { RegionId, RegionProfile } from '../game/region.js';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';

const isLocalWindows = os.platform() === 'win32';

if (isLocalWindows && fs.existsSync('.env.development')) {
  console.log('Env: development');
  dotenv.config({ path: '.env.development' });
}

dotenv.config();

const env = {
  string: (key: string, defaultVal: string) => process.env[key] || defaultVal,

  number: (key: string, defaultVal: number, min?: number, max?: number) => {
    const raw = process.env[key];
    if (!raw) return defaultVal;
    const num = Number(raw);
    if (isNaN(num)) return defaultVal;
    if (min !== undefined && num < min) return defaultVal;
    if (max !== undefined && num > max) return defaultVal;
    return num;
  },

  boolean: (key: string, defaultVal: boolean) => {
    const raw = process.env[key];
    if (!raw) return defaultVal;
    const lower = raw.toLowerCase();
    return lower === 'true' || lower === '1';
  },

  numberArray: (key: string, defaultVal: number[]) => {
    const raw = process.env[key];
    if (!raw) return defaultVal;
    return raw
      .split('|')
      .map((s) => Number(s.trim()))
      .filter((n) => !isNaN(n));
  },
};

export interface RegionCredentials {
  accountId: number;
  password: string;
}

const REGION_ACCOUNT_KEYS: Record<RegionId, { id: string; password: string }> =
  {
    cn: { id: 'SERVICE_ACCOUNT_ID', password: 'SERVICE_ACCOUNT_PASSWORD' },
    tw: {
      id: 'TW_SERVICE_ACCOUNT_ID',
      password: 'TW_SERVICE_ACCOUNT_PASSWORD',
    },
  };

const regionEnv = env.string('REGION', 'cn').toLowerCase();
const region: RegionId = regionEnv === 'tw' ? 'tw' : 'cn';
const accountKeys = REGION_ACCOUNT_KEYS[region];

const regionEnvError =
  regionEnv === 'cn' || regionEnv === 'tw'
    ? null
    : `REGION=${regionEnv} 不是有效取值，仅支持 cn / tw`;

// 大陆服兜底
const gameServerHost = env.string('GAME_SERVER_HOST', '175.24.235.221');
const gameServerPort = env.number('GAME_SERVER_PORT', 1225);

function resolveRegionProfile(): RegionProfile {
  const profile = PROFILES[region];

  if (region !== 'cn') return profile;

  return {
    ...profile,
    defaultServer: {
      ...profile.defaultServer,
      ip: gameServerHost,
      port: gameServerPort,
    },
  };
}

interface Settings {
  regionProfile: RegionProfile;
  account: RegionCredentials;

  http_port: number;
  log_callbacks: boolean;
  log_full_packet: boolean;
  ignored_cmd_ids: number[];

  queue_delay_ms: number;
  queue_max_length: number;
  queue_wait_timeout_ms: number;

  feishu_webhook_url: string;
  feishu_webhook_secret: string;
}

export const settings: Settings = {
  regionProfile: resolveRegionProfile(),
  account: {
    accountId: env.number(accountKeys.id, 0),
    password: env.string(accountKeys.password, ''),
  },

  http_port: env.number('PORT', 3000, 1, 65535),
  log_callbacks: env.boolean('LOG_CALLBACKS', true),
  log_full_packet: env.boolean('LOG_FULL_PACKET', false),
  ignored_cmd_ids: env.numberArray(
    'IGNORED_CMD_IDS',
    [8002, 8015, 3452, 2004, 2001, 41228, 1002, 2002],
  ),

  // TCP 串行请求队列：游戏服务器只接受单线程访问
  queue_delay_ms: env.number('QUEUE_DELAY_MS', 50, 0, 5000),
  queue_max_length: env.number('QUEUE_MAX_LENGTH', 50, 1, 10000),
  // 应小于调用方（seer-info-summary 后端）的 HTTP 超时 10s
  queue_wait_timeout_ms: env.number('QUEUE_WAIT_TIMEOUT_MS', 8000, 1000, 60000),

  feishu_webhook_url: env.string('FEISHU_WEBHOOK_URL', ''),
  feishu_webhook_secret: env.string('FEISHU_WEBHOOK_SECRET', ''),
};

/**
 * 启动期配置问题，返回 null 表示配置足以登录。
 * 只负责说明问题，是否终止进程由调用方决定。
 */
export function describeConfigProblem(): string | null {
  if (regionEnvError) return regionEnvError;

  const { accountId, password } = settings.account;
  if (accountId && password) return null;

  const keys = REGION_ACCOUNT_KEYS[region];
  return `未配置 ${region} (${settings.regionProfile.label}) 大区账号，请在 .env 中填写 ${keys.id} / ${keys.password}`;
}
