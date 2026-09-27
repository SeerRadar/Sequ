import os from 'os';

/**
 * 设备标识字段。客户端填的是 Unity 平台名与设备型号，服务端未做校验。
 * 取不到主机平台对应名字时回退 WindowsPlayer，即官方客户端上报的取值。
 */
const PLATFORM_NAMES: Record<string, string> = {
  win32: 'WindowsPlayer',
  darwin: 'OSXPlayer',
  linux: 'LinuxPlayer',
};

export const DEVICE_PLATFORM_NAME =
  PLATFORM_NAMES[os.platform()] ?? 'WindowsPlayer';
