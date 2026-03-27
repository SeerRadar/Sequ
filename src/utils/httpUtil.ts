const isValidAccount = (account: number): boolean => {
  return !!account && account >= 50000 && account <= 2000000000;
};

const getInvalidAccountRes = (account: any, includeStatus = false) => {
  const res: any = {
    success: false,
    message: "数据返回失败",
    data: {
      account: String(account || ""),
      error: "请输入正确的米米号, 从50000开始，2000000000封顶",
    },
  };
  if (includeStatus) res.status = 1;
  return res;
};

const toHexStr = (buf: Buffer | null): string => {
  return buf ? buf.toString("hex").toUpperCase() : "";
};

export { isValidAccount, getInvalidAccountRes, toHexStr };
