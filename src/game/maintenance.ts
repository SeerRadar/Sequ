import axios from 'axios';

export interface UnityNoticeItem {
  type: number;
  text?: string;
}

/** 维护公告（type=3 视为维护中） */
export async function getUnityNoticeInfo(
  url: string = 'http://unity-notice.61.com/unity_notice/',
): Promise<UnityNoticeItem[]> {
  const { data } = await axios.get<UnityNoticeItem[]>(url + `?t=${Date.now()}`);
  if (!Array.isArray(data)) {
    throw new Error('notice 数据格式错误');
  }
  return data;
}

export function parseUnityNotice(noticeList: UnityNoticeItem[]): {
  status: '维护' | '开服';
  info: string;
} {
  const maintenanceNotice = noticeList.find((n) => n.type === 3);

  if (maintenanceNotice) {
    return {
      status: '维护',
      info: maintenanceNotice.text || '当前有维护公告，但未提供具体信息',
    };
  }

  return {
    status: '开服',
    info: '当前unity已开服',
  };
}
