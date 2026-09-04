type InvalidAccountRes = {
  success: false;
  message: string;
  data: {
    account: string;
    error: string;
  };
  status?: number;
};

const MIN_ACCOUNT = 50000;
const MAX_ACCOUNT = 2000000000;

const isValidAccount = (account: number): boolean => {
  return !!account && account >= MIN_ACCOUNT && account <= MAX_ACCOUNT;
};

/**
 * 校验分页参数：非有限数、负数或 end < start 均视为非法
 */
const isValidPagination = (startIdx: number, endIdx: number): boolean =>
  Number.isFinite(startIdx) &&
  Number.isFinite(endIdx) &&
  startIdx >= 0 &&
  endIdx >= startIdx;

const getInvalidAccountRes = (
  account: unknown,
  includeStatus = false,
): InvalidAccountRes => {
  const res: InvalidAccountRes = {
    success: false,
    message: '数据返回失败',
    data: {
      account: String(account || ''),
      error: '请输入正确的米米号, 从50000开始，2000000000封顶',
    },
  };
  if (includeStatus) res.status = 1;
  return res;
};

export { isValidAccount, getInvalidAccountRes, isValidPagination };
