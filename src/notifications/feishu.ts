import { settings } from '../config/config.js';
import axios from 'axios';
import crypto from 'crypto';

const webhookUrl: string = settings.feishu_webhook_url;
const secret: string = settings.feishu_webhook_secret;

interface WebhookResult {
  success: boolean;
  error?: string;
}

interface TextMessagePayload {
  msg_type: 'text';
  content: { text: string };
}

/**
 * 生成签名
 */
function genSign(secret: string): { timestamp: number; sign: string } {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = Buffer.from(`${timestamp}\n${secret}`, 'utf8');

  const sign = crypto
    .createHmac('sha256', key)
    .update(Buffer.alloc(0))
    .digest('base64');

  return { timestamp, sign };
}

/**
 * 发送 webhook
 */
async function sendWebhook(body: TextMessagePayload): Promise<WebhookResult> {
  try {
    if (!webhookUrl || !secret) {
      console.warn('Feishu webhook not configured');
      return { success: false };
    }

    const { timestamp, sign } = genSign(secret);

    const { data } = await axios.post<{ code: number }>(webhookUrl, {
      timestamp,
      sign,
      ...body,
    });

    if (data.code !== 0) {
      console.error('Feishu error:', data);
      return { success: false };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Feishu request error:', message);
    return { success: false, error: message };
  }
}

/**
 * 发送文本消息
 */
export function sendTextMessage(
  text: string,
): Promise<WebhookResult> | undefined {
  if (!text) return;

  return sendWebhook({
    msg_type: 'text',
    content: {
      text,
    },
  });
}
