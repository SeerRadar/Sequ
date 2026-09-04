/**
 * Buffer → 大写 HEX 字符串（空输入返回空字符串）
 */
export function toHexStr(buf: Buffer | null): string {
  return buf ? buf.toString('hex').toUpperCase() : '';
}
