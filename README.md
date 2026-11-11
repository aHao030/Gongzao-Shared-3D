# 共造 · 共享3D打印 v0.9

面向个人创作者与制造商家的共享制造平台。客户上传模型和需求，商家维护制造能力及工艺配置，客户确认版本化方案；商家在生产中心管理模型分析、切片任务、库存预留、完工实耗与质检。

**当前交易和生产执行仍为沙盒。** 独立运算服务可以真实运行模型分析、切片估算与排期；接入外部服务需要管理员配置。模拟付款不会解锁真实打印机，也不会产生真实商家结算。

## 立即使用

1. 安装 Node.js 24，将项目完整解压。
2. Windows 双击 `START-WINDOWS.cmd`；macOS 双击 `start-macos.command`；Linux 运行 `bash start-linux.sh`。
3. 保持启动窗口开启，浏览器打开 `http://127.0.0.1:3000`。商家入口为 `/merchant/login`。
4. 注册共造邮箱账号并登录，再开通商家资料。使用新设的共造密码，不是邮箱密码。

基础网页和 SQLite 服务不需要安装 Python、Redis、Docker 或运行 npm install。也可在项目文件夹执行：

```sh
node services/platform/local.mjs
```

不要直接双击 `dist/index.html`。`127.0.0.1` 只用于当前电脑；其他设备访问和正式部署需要 HTTPS、域名及独立身份配置。

## 已有项目升级

停止旧版启动窗口中的服务，将新版解压到另一个目录，再从**新包**双击 `UPDATE-WINDOWS.cmd`。默认目标仍为：

```text
D:\Gongzao-Shared-3D-v0.6-Download\Gongzao-Shared-3D-v0.7
```

更新工具检查文件哈希、备份旧代码，保留 `data/`、账号数据库和私人配置。不删除旧目录，不覆盖本地凭据。其他路径及恢复步骤见 [v0.9 更新说明](docs/UPDATE_WINDOWS_V0.9.md)。

## 本版新增

| 能力 | 当前实现 | 使用边界 |
| --- | --- | --- |
| 模型分析 | 独立 Trimesh 运算，尺寸、体积、闭合、法向、连通体及警告 | 几何通过不等于强度/壁厚或可制造性认证 |
| 切片估算 | PrusaSlicer CLI 适配器，绑定文件哈希、配置版本、数量、单位和引擎版本 | 需本地安装切片器和登记商家配置；不驱动机器 |
| 报价 | 匹配真实切片结果时，用整单耗材和工时重新计价；保持三项利润底线 | 缺结果继续明确标识演示估算；不改已付款订单 |
| 任务队列 | SQLite/D1 持久任务、租约、领取、重试、版本核对和 worker 重启恢复 | 默认无需 Redis；BullMQ 是独立可选适配器，尚非主调度器 |
| 生产中心 | 耗材预留、备机、模拟生产、实耗核算、取件质检、订单进度同步 | 真机启动、资金转移始终关闭 |
| 库存 | 手工库存与 Spoolman 观测库存分开；模拟生产只扣演示库存 | 外部余量未知的耗材不导入为可用库存 |
| 排期 | 基础逐机排期；独立 OR-Tools 计算非重叠建议 | 交期还需人工、维护、后处理和物流数据 |
| 服务连接 | Spoolman、FDM Monster、Obico、Karrio、Hyperswitch、Moonraker、OctoPrint 适配器 | 没有凭据时显示未配置；没有宣称全机型支持 |
| 身份 | 本地邮箱密码、OIDC、Keycloak 部署配置、商家与 worker 独立权限 | 社交应用、SMTP 和真实多商户市场需要单独验收 |
| CNC | 离线引擎可生成工程审核清单，网页仍走人工审核 | 尚无网页导出入口，不执行 FreeCAD、自动 CAM 或 CNC 开机 |

## 生产中心演练

客户先上传模型或使用明确标识的演示模型。商家进入“生产中心”：

1. 在“工艺模板”登记材料、质量、计价产线和设备。
2. 在“材料库存”建立一卷演示耗材并填写余量及采购价。
3. 在“生产任务”选择模型、数量、单位和模板，运行演示切片；需要真实计算时改用独立运算服务。
4. 为已经模拟付款的匹配订单创建生产台账。旧版已开始的模拟订单需要明确确认迁移，并重新备机。
5. 确认清台、材料与设备状态后模拟派单，完工填写实际耗材和时间，再提交取件质检。
6. 质检通过后继续已有订单的模拟发货、签收、客户验收与结算。

客户不需要填写打印温度、速度或支撑参数。商家工艺改变后，旧任务和旧报价必须重新核对。

## 连接真实运算与外部服务

| 文档 | 内容 |
| --- | --- |
| [v0.9 接入与验收](docs/RELEASE_V0.9.md) | 版本范围、步骤、API 和实际验证边界 |
| [制造运算服务](docs/MANUFACTURING_WORKER_V0.9.md) | Python 依赖、PrusaSlicer、白名单配置、worker 启动 |
| [外部服务](docs/INTEGRATIONS_V0.9.md) | Spoolman、设备、物流、监控、支付测试连接与可选 BullMQ |
| [Keycloak 身份](docs/IDENTITY_V0.9.md) | 账号服务、邮箱验证、第三方入口与服务器密钥 |
| [生产领域合同](docs/OPERATIONS_CONTRACT_V0.9.md) | 库存、任务租约、生产状态和成本字段 |

运算凭据生成示例（OWNER_ID 从已登录的 `/api/v2/session` 的 `user.id` 获取）：

```sh
npm run worker:configure -- --owner OWNER_ID
```

生成的 `worker-access.config.json` 留在平台机器，`worker.config.json` 仅交给受信任运算服务。配置 Python 和工艺文件后，重启平台，再运行：

```sh
npm run worker -- --config worker.config.json --status
npm run worker -- --config worker.config.json
```

两个凭据文件不会被打包或更新覆盖。不要放在网页目录或发送给客户。当前托管站点展示生产中心沙盒；独立服务和凭据在本地部署配置，未将私人令牌上传到托管站点。

## 检查与构建

```sh
npm test
npm run check
```

制造测试需要 Python 时可设置 `GONGZAO_TEST_PYTHON` 为已安装依赖的 Python 路径。缺少依赖的测试会明确跳过，不代表通过真实运算。

构建托管 Worker 前安装开发依赖：

```sh
npm ci
npm run build
```

历史设计与当前验收见 [验证记录](docs/VALIDATION.md)、[部署说明](docs/DEPLOYMENT.md)、[模型方案流程](docs/MODEL_WORKFLOW_V0.8.md) 和 [批量利润规则](docs/BATCH_PRICING_V0.6.md)。

## 交付范围

网页、Windows/macOS/Linux 启动器、Tauri/Capacitor 包装工程与微信小程序工程均保留。小程序共享 API 已同步生产接口，但生产中心完整界面目前在网页；原生构建、签名、上架和微信真实登录尚未验收。

本项目仍是同一 owner 空间内的买卖流程沙盒。不同 owner 数据隔离，但尚未上线多个独立商家争抢同一客户订单的真实市场。真实支付准入、分账、争议处理及设备现场验收是商业试点的后续条件，不能用模拟订单代替。
