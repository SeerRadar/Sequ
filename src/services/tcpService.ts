import { SendPacketProcessing } from "../pkg/send";
import { ReceivePacketAnalysis } from "../pkg/receive";
import { Algorithms } from "../core/encrypt";
import { Login } from "../core/login";
import { settings } from "../config/config";

export class TCPService {
  private sender: SendPacketProcessing | null = null;
  private receiver: ReceivePacketAnalysis | null = null;
  private isReady: boolean = false;

  /**
   * 初始化 TCP 连接并完成登录和密钥交换
   */
  async init(): Promise<void> {
    const algorithms = new Algorithms();
    const login = new Login();

    console.log("正在登录 TCP 服务器...");

    const { reader, writer } = await login.login(
      settings.service_account_id,
      settings.service_account_password
    );

    this.sender = new SendPacketProcessing(
      algorithms,
      writer,
      settings.service_account_id,
      (msg) => console.log(msg)
    );

    this.receiver = new ReceivePacketAnalysis(
      algorithms,
      reader,
      settings.service_account_id,
      (msg) => console.log(msg),
      () => {
        console.log("【系统提示】网络连接已断开，准备退出或重连...");
        process.exit(0);
      }
    );

    // 等待 1001 密钥初始化封包处理完毕
    await new Promise((resolve) => setTimeout(resolve, 5000));
    this.isReady = true;
    console.log("TCP 服务端初始化完成，密钥就绪！");
  }

  async sendAndReceive(
    cmdId: number,
    hexPacket: string,
    timeout = 5000
  ): Promise<Buffer | null> {
    if (!this.isReady || !this.sender || !this.receiver) {
      throw new Error("TCP 服务端暂未连接或准备就绪");
    }

    const receivePromise = this.receiver.waitForSpecificData(cmdId, timeout);
    const sendSuccess = await this.sender.sendPacket(hexPacket);

    if (!sendSuccess) {
      throw new Error("封包发送失败");
    }

    const receivedData = await receivePromise;
    if (!receivedData) {
      return null;
    }
    // 截取 body 部分（去掉前 17 字节头部）
    const body = receivedData.subarray(17);

    return body;
  }
}

export const tcpService = new TCPService();
