export type ReplyPayload<T = unknown> = {
  success: boolean;
  message: string;
  code: number;
  data?: T;
  status?: number;
  [key: string]: unknown;
};

/**
 * 成功响应，默认 code 为 200。
 */
export const success = <T = unknown>(
  data?: T,
  message = '数据返回成功',
  code = 200,
  extra: Record<string, unknown> = {},
): ReplyPayload<T> => ({
  success: true,
  message,
  code,
  ...(data === undefined ? {} : { data }),
  ...extra,
});

/**
 * 失败响应，默认 code 为 500。
 */
export const fail = <T = unknown>(
  message = '数据返回失败',
  data?: T,
  code = 500,
  extra: Record<string, unknown> = {},
): ReplyPayload<T> => ({
  success: false,
  message,
  code,
  ...(data === undefined ? {} : { data }),
  ...extra,
});

/**
 * 参数错误响应，返回 code 400。
 */
export const badRequest = <T = unknown>(
  message = '请求参数错误',
  data?: T,
  extra: Record<string, unknown> = {},
): ReplyPayload<T> => fail(message, data, 400, extra);

/**
 * 资源未找到响应，返回 code 404。
 */
export const notFound = <T = unknown>(
  message = '资源未找到',
  data?: T,
  extra: Record<string, unknown> = {},
): ReplyPayload<T> => fail(message, data, 404, extra);
