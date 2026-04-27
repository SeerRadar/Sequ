import userRoutes from './routes/user.route.js';
import dayjs from 'dayjs';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use(cors());

app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  console.log(
    `[${dayjs().format('YYYY-MM-DD HH:mm:ss')}] ${c.req.method} ${url.pathname}${url.search}`,
  );
  await next();
});

app.route('/api', userRoutes);

app.notFound((c) => {
  return c.json({ success: false, message: '接口不存在' }, 404);
});

app.onError((err, c) => {
  console.error(
    `[${dayjs().format('YYYY-MM-DD HH:mm:ss')}] 未捕获错误:`,
    err.message,
  );
  return c.json(
    {
      success: false,
      message: '服务器内部错误',
      data: { error: err.message },
    },
    500,
  );
});

export { app };
