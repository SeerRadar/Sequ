import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dayjs from "dayjs";
import userRoutes from "./routes/user.route";

const app: express.Application = express();

app.use(cors());
app.use(express.json());

// 请求日志中间件
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(
    `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${req.method} ${
      req.originalUrl
    }`
  );
  next();
});

app.use("/api", userRoutes);

// 404 处理
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "接口不存在" });
});

export { app };
