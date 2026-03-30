import { tcpService } from "./services/tcpService";
import { app } from "./services/httpServer/app";
import { settings } from "./config/config";

async function bootstrap() {
  try {
    await tcpService.init();

    app.listen(settings.http_port, () => {
      console.log(
        `HTTP 服务器已启动: http://localhost:${settings.http_port}`
      );
    });
  } catch (error) {
    console.error("系统启动失败:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  bootstrap();
}
