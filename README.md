<img src="./img/logo.png" style="width:100%" />

# Sequ

> [!WARNING]
> 说明：本项目的登录实现、封包处理、查询组合、命令字典整理版本和相关工程组织来源于 [saixiaoxi](https://github.com/oldml/saixiaoxi)，基于原python版本重写为 TypeScript，后续更新中增加了其他功能，对oldml的付出表示感谢。

`Sequ` (seer-query | 赛蛆）一个可扩展的`赛尔号`数据查询服务。通过 TCP 长连接与游戏服务器通信，对外暴露基于 [Hono](https://hono.dev) 的 HTTP API，支持查询米米号信息、在线状态、战队信息、巅峰排行、投票排行等数据，类插件机制，具有良好的扩展性。

本项目为[赛尔号信息聚合页](https://seerinfo.yuyuqaq.cn/)的衍生子项目

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [运行命令](#运行命令)
- [HTTP API](#http-api)
- [项目结构](#项目结构)
- [开发说明](#开发说明)

## 功能特性

- 纯协议层实现，直接构建和解析游戏服务器的原始封包
- 自动心跳保活，自动重连
- 重连前检测维护公告，维护期间暂停重试
- 重连失败 / 重连终止支持飞书 Webhook 告警

## 技术栈

| 类别      | 选型                                      |
| --------- | ----------------------------------------- |
| 运行时    | Node.js 22+                               |
| 语言      | TypeScript 6.x（ESM, `module: NodeNext`） |
| 包管理器  | pnpm 10+                                  |
| HTTP 框架 | Hono 4.x                                  |

## 快速开始

1. 安装依赖

```bash
pnpm install
```

2. 准备环境变量

macOS / Linux:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

3. 编辑 `.env`，填写你的米米号和密码（`SERVICE_ACCOUNT_ID`、`SERVICE_ACCOUNT_PASSWORD`）

4. 启动开发服务器

```bash
pnpm dev
```

服务启动后 HTTP 服务器默认监听 `http://localhost:3000`。

## 配置说明

项目加载环境文件的优先级：

- **Windows 本地开发**：若工作目录下存在 `.env.development`，会**先**加载它
- 随后统一加载 `.env`（后加载的 `.env` 会覆盖 `.env.development` 中同名变量）

⚠ 所有 `.env*` 文件均已加入 `.gitignore`，切勿将真实账号密码提交到仓库。

### 环境变量一览

| 变量名                     | 说明                           | 默认值                                      | 必填 |
| -------------------------- | ------------------------------ | ------------------------------------------- | ---- |
| `GAME_SERVER_HOST`         | 游戏服务器地址                 | `175.24.235.221`                            | 否   |
| `GAME_SERVER_PORT`         | 游戏服务器端口                 | `1225`                                      | 否   |
| `SERVICE_ACCOUNT_ID`       | 登录米米号                     | `0`                                         | 是   |
| `SERVICE_ACCOUNT_PASSWORD` | 登录密码                       | `""`                                        | 是   |
| `PORT`                     | HTTP 服务端口                  | `3000`                                      | 否   |
| `LOG_CALLBACKS`            | 是否打印封包回调日志           | `true`                                      | 否   |
| `LOG_FULL_PACKET`          | 是否打印完整封包十六进制       | `false`                                     | 否   |
| `IGNORED_CMD_IDS`          | 日志屏蔽的命令 ID（`\|` 分隔） | `8002\|3452\|2004\|2001\|41228\|1002\|2002` | 否   |
| `FEISHU_WEBHOOK_URL`       | 飞书机器人 Webhook 地址        | `""`                                        | 否   |
| `FEISHU_WEBHOOK_SECRET`    | 飞书机器人签名密钥             | `""`                                        | 否   |

未配置 `SERVICE_ACCOUNT_ID` 或 `SERVICE_ACCOUNT_PASSWORD` 时，程序会打印警告但仍会启动。

## 运行命令

```bash
pnpm dev          # 开发模式（tsx 直接运行 TS，无需编译）
pnpm build        # TypeScript 编译到 dist/
pnpm start        # 编译后启动（等价于 pnpm build && node dist/index.js）
pnpm lint         # oxlint 检查
pnpm lint:fix     # oxlint 自动修复
pnpm format       # Prettier 格式化（含 import 排序）
```

## HTTP API

所有接口挂载在 `/api` 路径下。统一响应格式：

```json
{
  "success": true,
  "message": "获取成功",
  "code": 200,
  "data": {}
}
```

### 1) GET /api/users/:account/online-status

查询米米号昵称和在线状态。

| 参数    | 类型   | 必填 | 说明                                        |
| ------- | ------ | ---- | ------------------------------------------- |
| account | number | 是   | 米米号（路径参数），范围 50000 ~ 2000000000 |

成功示例：

```json
{
  "success": true,
  "message": "数据返回成功",
  "code": 200,
  "data": {
    "account": "12345678",
    "nickName": "玩家昵称",
    "online": true,
    "server": "3"
  }
}
```

### 2) GET /api/users/:account

查询用户详细信息（含多段原始十六进制数据）。

| 参数    | 类型   | 必填 | 说明                                        |
| ------- | ------ | ---- | ------------------------------------------- |
| account | number | 是   | 米米号（路径参数），范围 50000 ~ 2000000000 |

成功示例：

```json
{
  "success": true,
  "message": "数据返回成功",
  "code": 200,
  "status": 1,
  "data": {
    "account": "12345678",
    "nickName": "玩家昵称",
    "online": false,
    "hexDataMore": "...",
    "hexDataSimple": "...",
    "hexDatapart1": "...",
    "hexDatapart2": "...",
    "hexDataPeak": "..."
  }
}
```

hex 字段说明：

| 字段          | 来源                        |
| ------------- | --------------------------- |
| hexDataMore   | cmd 2052 用户基础信息       |
| hexDataSimple | cmd 2051 简版信息           |
| hexDatapart1  | cmd 41298 param=1           |
| hexDatapart2  | cmd 41298 param=5           |
| hexDataPeak   | 循环请求 cmd 40002 拼接结果 |

### 3) GET /api/teams/:teamId

查询战队信息。

| 参数   | 类型   | 必填 | 说明                        |
| ------ | ------ | ---- | --------------------------- |
| teamId | number | 是   | 战队 ID（路径参数，大于 0） |

成功示例：

```json
{
  "success": true,
  "message": "获取成功",
  "code": 200,
  "data": {
    "teamId": "1001",
    "hexDataTeam": "..."
  }
}
```

### 4) GET /api/votes

查询巅峰投票排行。

| 参数     | 类型   | 必填 | 说明                         |
| -------- | ------ | ---- | ---------------------------- |
| voteDate | number | 是   | 投票日期（例如 20210526）    |
| voteType | number | 否   | 0 限制级，1 准限制级，默认 0 |
| startIdx | number | 否   | 起始下标，默认 0             |
| endIdx   | number | 否   | 结束下标，默认 25            |

成功示例：

```json
{
  "success": true,
  "message": "获取成功",
  "code": 200,
  "data": {
    "voteList": [{ "voteMonsterId": 3001, "voteCount": 12345 }]
  }
}
```

### 5) GET /api/peak/rank

查询巅峰排行榜。

| 参数     | 类型   | 必填 | 说明                                         |
| -------- | ------ | ---- | -------------------------------------------- |
| key      | number | 否   | 直接指定排行 key                             |
| page     | number | 否   | 页面类型：1 玩家，2 精灵，3 套装，4 称号     |
| mode     | number | 否   | 模式：0 竞技，1 狂野，2 专家，3 大师，默认 0 |
| tab      | number | 否   | 子分类索引，默认 0                           |
| subkey   | number | 是   | 子 key                                       |
| startIdx | number | 否   | 起始下标，默认 0                             |
| endIdx   | number | 否   | 结束下标，默认 99                            |

当 `key` 未传或非法时，服务会根据 `page`、`mode`、`tab` 自动计算。

成功示例：

```json
{
  "success": true,
  "message": "获取成功",
  "code": 200,
  "data": {
    "key": 120,
    "subkey": 20210526,
    "startIdx": 0,
    "endIdx": 99,
    "rankList": [{ "userid": 12345678, "score": 999999, "nick": "玩家昵称" }]
  }
}
```

### 6) GET /api/rankings/book-achievement

查询图鉴或成就排行。

| 参数     | 类型   | 必填 | 说明              |
| -------- | ------ | ---- | ----------------- |
| type     | number | 是   | 0 图鉴，1 成就    |
| startIdx | number | 否   | 起始下标，默认 0  |
| endIdx   | number | 否   | 结束下标，默认 99 |

成功示例：

```json
{
  "success": true,
  "message": "获取成功",
  "code": 200,
  "data": {
    "key": 156,
    "subkey": 1,
    "startIdx": 0,
    "endIdx": 99,
    "rankList": [{ "userid": 12345678, "score": 321, "nick": "玩家昵称" }]
  }
}
```

### 7) GET /api/rankings/auto-card

查询群星牌排行。

| 参数     | 类型   | 必填 | 说明              |
| -------- | ------ | ---- | ----------------- |
| startIdx | number | 否   | 起始下标，默认 0  |
| endIdx   | number | 否   | 结束下标，默认 99 |

成功示例：

```json
{
  "success": true,
  "message": "获取成功",
  "code": 200,
  "data": {
    "key": 240,
    "subkey": 1,
    "startIdx": 0,
    "endIdx": 99,
    "rankList": [{ "userid": 12345678, "score": 321, "nick": "玩家昵称" }]
  }
}
```

### 8) GET /api/wishes

查询周年庆许愿信息。

| 参数 | 类型   | 必填 | 说明                           |
| ---- | ------ | ---- | ------------------------------ |
| type | number | 是   | 0 皮肤，1 套装，2 部件，3 刻印 |

成功示例：

```json
{
  "success": true,
  "message": "获取成功",
  "code": 200,
  "data": {
    "list": [
      {
        "wishitemId": 1001,
        "wishitemIsHave": 1,
        "wishitemCurProgress": 50,
        "wishitemMaxProgress": 100,
        "wishitemPrayPop": []
      }
    ]
  }
}
```

## 项目结构

```text
src/
  index.ts                            # 入口：tcpService.init() → HTTP 服务
  config/
    config.ts                         # 环境变量加载 + Settings 配置导出
  game/                               # 游戏服务器 TCP 通信域
    crypto.ts                         # 封包加解密（Algorithms：密钥初始化、result 计算）
    bootstrap/
      login.ts                        # 账号登录：获取 session、TCP 建连、拼装登录包
      serverList.ts                   # 服务器列表发现（onlineID / IP / 端口）
    packet/                           # 封包二进制编解码原语
      protocol.ts                     # 协议常量（HEADER_SIZE 等）+ parsePacket
      builder.ts                      # 封包构建（PacketBuilder）
      reader.ts                       # 封包顺序读取（BufferReader）
      format.ts                       # 封包格式化 / hex 转换
      parser.ts                       # 通用响应结构解析（parseRankList 等）
      commands.ts                     # 命令 ID ↔ 名称映射
      Command.json                    # 命令字典数据
    transport/
      sender.ts                       # 封包发送处理（加密、组包、写 socket）
      receiver.ts                     # 封包接收解析（拆流、按 cmdId 匹配响应、维护通知）
    queue.ts                          # TCP 串行请求队列（单飞行、排队超时、统计）
    maintenance.ts                    # 维护公告探测（重连前检查）
    client.ts                         # TCP 生命周期单例 tcpService（连接、心跳、重连）
  api/                                # 对外 HTTP API 域
    app.ts                            # Hono 应用实例（CORS、请求日志、路由挂载）
    routes.ts                         # /api/* 全部路由定义
    controllers/
      user.controller.ts              # 用户 / 在线状态 / 背包精灵 / 战队接口
      peak.controller.ts              # 巅峰排行 / 投票接口
      history.controller.ts           # 巅峰对战历史接口
      rank.controller.ts              # 图鉴成就 / 自动精灵卡排行接口
      wish.controller.ts              # 许愿信息接口
      packet.controller.ts            # 原始封包发送接口
    helpers/
      reply.ts                        # 统一响应构建（success / fail / badRequest 等）
      validate.ts                     # 米米号参数校验
  notifications/
    feishu.ts                         # 飞书 Webhook 推送
```

## 开发说明

- **ESM**：项目使用 `"type": "module"`，源码 import 路径必须带 `.js` 后缀（`moduleResolution: NodeNext`）
- **verbatimModuleSyntax**：`import type` 用于纯类型导入，不可用 `import { type Foo }`
- **isolatedModules**：禁止 enum 合并和 namespace 导出
- **strict** + **noUncheckedIndexedAccess**：严格类型检查
- **格式化**：单引号、分号、80 字符行宽，import 自动排序
- **测试**：当前仓库不含测试框架和测试文件

## 注意事项

- 返回的十六进制数据多为游戏协议原始字节，未做字段反序列化
- 对外错误信息以 `message` + `code` + `data.error` 为准
- 请勿将 `.env*` 文件或含真实账号密码的配置提交到版本控制
