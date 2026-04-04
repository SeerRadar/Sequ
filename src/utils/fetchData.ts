import axios from "axios";

const MIDNIGHT_SHORT_MAINTENANCE_START_HOUR = 0;
const MIDNIGHT_SHORT_MAINTENANCE_END_HOUR = 1;

type UnityNoticeStatus = "维护" | "开服" | "疑似短时维护";

interface UnityNoticeParseResult {
  status: UnityNoticeStatus;
  info: string;
}

async function getUnityNoticeInfo(
  url: string = "http://unity-notice.61.com/unity_notice/",
) {
  const { data } = await axios.get(url + `?t=${Date.now()}`);
  if (!Array.isArray(data)) {
    throw new Error("notice 数据格式错误");
  }
  return data;
}

function parseUnityNotice(
  noticeList: any[],
  now: Date = new Date(),
): UnityNoticeParseResult {
  const maintenanceNotice = noticeList.find((n) => n.type === 3);
  const currentHour = now.getHours();
  const isMidnightWindow =
    currentHour >= MIDNIGHT_SHORT_MAINTENANCE_START_HOUR &&
    currentHour < MIDNIGHT_SHORT_MAINTENANCE_END_HOUR;

  if (maintenanceNotice) {
    return {
      status: "维护",
      info: maintenanceNotice.text || "当前有维护公告，但未提供具体信息",
    };
  }

  if (isMidnightWindow) {
    return {
      status: "疑似短时维护",
      info: "凌晨时段公告可能存在延迟，进入快速重连探测模式",
    };
  }

  return {
    status: "开服",
    info: "当前unity已开服",
  };
}

export { getUnityNoticeInfo, parseUnityNotice };
