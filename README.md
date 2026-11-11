# 共造 · 共享3D打印 v0.3

连接个人创作者与制造商家的跨端工程。网页采用黑、白、灰和更简洁的导航；新增独立商家入口、设备登记册查询、网关配对及设备发现/导入流程。

模型上传、报价、订单和履约状态保存在服务端。**制造报价、付款、打印、物流与结算仍为沙盒模拟。** 新网关只读取设备识别信息，添加设备不会启动打印或产生真实费用。

## 立即运行

安装 **Node.js 24**，全部解压项目。在包含 `package.json` 的目录执行：

```sh
node services/platform/local.mjs
```

Windows 也可在资源管理器中打开项目文件夹，在地址栏输入 `cmd` 后执行：

```bat
node services\platform\local.mjs
```

保持命令窗口开启，在同一电脑访问：

| 地址 | 用途 |
| --- | --- |
| `http://127.0.0.1:3000` | 客户上传、报价与订单 |
| `http://127.0.0.1:3000/merchant/login` | 独立商家入口 |
| `http://127.0.0.1:3000/merchant` | 商家工作台 |
| `http://127.0.0.1:3000/health` | 服务运行状态 |

本地启动不需要先执行 `npm install` 或 `npm ci`，也不要直接双击 `dist/index.html`。端口被占用时加 `--port 3001`，并使用对应地址。`127.0.0.1` 指当前电脑，不能直接作为其他电脑或手机的访问地址。

SQLite 默认保存在 `data/platform.sqlite`。保留原浏览器会话和数据库时，刷新或重启仍可看到原数据。该会话是本地沙盒身份，不是正式会员注册、企业认证或账号恢复系统。

## 商家使用

从独立入口建立商家资料后，可以查询已登记设备。要发现局域网中的真实设备，先在商家工作台配对网关并下载配置，然后在商家的电脑运行：

```sh
node services/device-gateway/cli.mjs --config gateway.private.json
```

回到设备中心进行检测，核对候选结果后选择导入。当前私人托管站点另有服务访问要求：网关配对令牌不代替站点权限，需要由操作者在本地配置 `siteAccessToken`；网页不会下载或收集该平台凭据。本地平台与网关同机运行时不需要此项。网关支持 Moonraker / OctoPrint 的只读识别路线；真实设备接口授权在本地配置。没有网关时可以明确选择演示流程，系统不会用样例冒充真实检测结果。

详见 [商家操作指南](docs/MERCHANT_GUIDE.md)。私人托管网页不能直接扫描你的局域网；本地网关、真实机型及网络条件需要现场验收。

## 检查与构建

```sh
npm test
npm run check
```

需要构建托管 Worker 时，再安装锁定的开发依赖：

```sh
npm ci
npm run build
```

`npm run test:load` 是本地功能负载样本，不代表生产容量。执行结果以 [验证记录](docs/VALIDATION.md) 为准，不把配置解析或生成源码视为真机通过。

## 工程组成

| 目录 | 作用与状态 |
| --- | --- |
| `dist/` 顶层网页资源 | 客户网页、独立商家入口和设备流程；调用服务端 API |
| `services/platform/` | 领域规则、HTTP、本地 SQLite 与托管 D1/R2；保存商家资料、设备登记及扫描状态 |
| `services/device-gateway/` | 本地只读发现网关；轮询受限扫描任务，不接受打印启动指令 |
| `db/`、`drizzle/` | 托管数据库定义和迁移 |
| `apps/weapp/` | 微信三页工程；远端登录和真机仍待适配 |
| `apps/mobile/` | Android / iOS Capacitor 包装工程，尚未签名及真机验收 |
| `apps/desktop/` | Windows / macOS / Linux Tauri 包装工程，尚未交付签名安装包 |
| `apps/shared/` | 跨端 API 客户端和受限网页资源准备流程 |
| `services/gateway-simulator/` | 原有离线生产协议模拟；与新只读发现网关用途不同 |
| `services/api/`、`packages/domain/` | 保留 v0.1 演示接口与领域回归；当前网页使用平台服务 |
| `tests/`、`apps/tests/`、`tools/` | 自动化、静态检查及负载样本 |

## 边界与正式部署

- 私人托管身份与本地浏览器会话分别保存数据，不自动同步。新的商家入口和资料开通不等于企业资质审核完成。
- 设备登记与原有模拟生产设备分开。发现到设备不代表已经认证工艺、材料、清台状态或自动开机能力。
- STL 上传、几何检查与示例计价保留；STEP、3MF 和图片进入工程审核，当前未替代完整 CAD、切片或 CAM。
- 真实多方商家权限、支付账本、物流回调、制造派发和现场故障恢复仍需实现。旧沙盒履约接口不能直接作为公网商业权限系统。
- Android/Samsung、iOS、桌面和微信还需分别完成身份接入、原生构建、签名、真机与上架审核；当前没有原生鸿蒙 HAP 交付。
- 本地服务默认仅供本机访问，不应直接暴露到公网。网关配置及密钥保留在商家本地，不提交到源码仓库。

阅读 [v0.3 实施说明](docs/IMPLEMENTATION_V0.3.md)、[任务日志](docs/TASK_LOG.md)、[部署说明](docs/DEPLOYMENT.md)、[API v2](docs/API_V2.md)、[跨端说明](docs/CROSS_PLATFORM.md) 和 [生产验收门槛](docs/PRODUCTION_READINESS.md)。历史设备/GitHub研究见 [来源](docs/SOURCES.md)。
