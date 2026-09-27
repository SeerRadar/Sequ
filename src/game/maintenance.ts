import axios from 'axios';

/** 维护公告项。type 在大陆服是数字、台服是字符串，统一按数值比较 */
export interface UnityNoticeItem {
  type: number | string;
  text?: string;
}

/** 公告中 type=3 表示维护（AnnouncementType.Maintain） */
const NOTICE_TYPE_MAINTAIN = 3;

export async function getUnityNoticeInfo(
  url: string,
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
  const maintenanceNotice = noticeList.find(
    (n) => Number(n.type) === NOTICE_TYPE_MAINTAIN,
  );

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
