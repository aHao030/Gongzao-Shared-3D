# v0.9 外部服务接入

本版本提供可调用适配器、配置校验、商家界面连接状态和独立测试。未配置时返回 `NOT_CONFIGURED`；网络/授权失败明确报错，不回退为成功或演示数据。默认网页与本地沙盒不触发实际扣款、分账或设备启动。

## 已交付范围

| 服务 | 实现 | 仍需提供/验证 |
| --- | --- | --- |
| Spoolman | 分页读取耗材卷及剩余/已用克数，字段白名单；同步最多500卷并声明截断 | 本机或私网实例；平台预留与采购成本独立维护；未知余额不能当0库存或可用库存 |
| Moonraker / OctoPrint | 状态查询、SHA-256绑定文件上传、带持久指令账本的启动适配器 | 现场设备、已审批配置、真实付款证据、清台/备料和新鲜状态；写接口不暴露到浏览器 |
| FDM Monster | API v2 设备列表读取与连接检查 | 本机实例/API Key；具体机型与固件现场验收；Bambu仍按实际支持核对 |
| Obico | 只读设备/监控摘要，不返回摄像头私有链接和设备令牌 | read scope OAuth token或自托管凭据；识别告警需人工处理，不能自动质检/赔付 |
| Karrio | 运价查询、运单跟踪、事件去重排序与状态归一 | 承运商连接/凭据、目标国家覆盖；返回签收不自动触发客户验收或放款 |
| Hyperswitch | 只创建 `confirm:false` 测试支付意向；按订单/金额/币种核验查询结果 | 连接器账户和测试凭据；没有确认、捕获、退款或分账的公开接口，不接收银行卡数据 |
| BullMQ | 可选任务队列适配器、稳定任务ID/内容指纹/有界重试 | 独立Redis服务；不是生产账本的替代；真实设备start禁止放进自动重试队列 |

三方实例未在本次环境实际启动联调。适配器测试使用固定响应和真实本机HTTP服务；不能据此宣称已验证某个农场、支付账户或承运商。

## Windows / macOS / Linux 本地连接

1. 保持原有 `npm start` 可运行。按需安装 Docker Desktop / Docker Engine 后，在项目根目录启动选配服务：

```sh
docker compose -f compose.integrations.yaml --profile inventory up -d
docker compose -f compose.integrations.yaml --profile farm up -d
```

Spoolman 本机地址为 `http://127.0.0.1:7912`，FDM Monster 为 `http://127.0.0.1:4000`。这些地址只给管理员配置使用，客户页面不展示。镜像固定为 Spoolman 0.27.1 和 FDM Monster 2.1.0（取其上游发布/Compose记录）；部署前可验证镜像签名并锁定digest。此文件不启动Obico/Karrio/Hyperswitch的多组件服务，按各项目的官方自托管步骤安装后再接入，避免省略数据库/密钥等必需配置。

2. 将 `services/integrations/config.example.json` 复制为项目根目录的 `integrations.config.json`。填入真实本地工作空间 `ownerId`。该值来自当前已登录账户的 `/api/v2/session` 中 `user.id`；不能填邮箱、商家名称或其他人的ID。
3. 为需要的服务填写 `baseUrl`，不使用的服务留空。服务只属于配置中的一个工作空间；其他账户只能看到未配置状态。多农场正式部署应将配置存入每商户独立秘密存储，本文件不实现跨商户共享密钥。
4. 在服务器环境设置对应的 `GONGZAO_*` 密钥变量。配置内 `apiKeyEnv` 读取环境变量，密钥不发送到网页。配置文件、环境文件、数据库和日志不应提交或打包。
5. 重启本地平台，进入商家工作台的“服务连接”检查。可先运行命令行：

```sh
node services/integrations/cli.mjs status
node services/integrations/cli.mjs probe --service spoolman
node services/integrations/cli.mjs spools
node services/integrations/cli.mjs tracking --carrier ups --tracking YOUR_TRACKING_NUMBER
```

可用 `--config /absolute/path/integrations.config.json` 指定文件，或设置 `GONGZAO_INTEGRATIONS_CONFIG`。CLI 输出为脱敏业务字段，但运单和耗材信息仍属于商家私有数据。

若平台自身运行于容器，`127.0.0.1` 指向该容器自身。将服务放在同一个受控Docker网络，配置该网络内服务名；同时把精确服务origin加入 `allowPrivateOrigins`。不要把内部服务端口开放到公网。

## 网络与身份边界

- 配置只由本机管理员读取；HTTP接口不接受客户端服务URL、密钥、文件系统路径或任意请求方法。
- 公网只允许HTTPS。HTTP及私网地址必须在服务器 `allowPrivateOrigins` 精确白名单中。
- 原生HTTP传输先解析DNS并固定连接地址，拒绝未授权私网解析、跨域/同域重定向、超时与超过1 MiB的响应。
- `hub.status({ownerId})` 对未绑定账户返回全未配置；每个读写方法再次校验owner。
- 健康检查仅表明接口可达。Hyperswitch `/health` 是公开健康接口，成功不代表API Key有效、更不代表已开通支付。
- 集成配置属于本地服务；托管Worker没有局域网连接和本地秘密文件，显示未配置。不要为此把农场设备直接开放到公网。

## 程序接口合同

```js
import { loadIntegrationConfig, createIntegrationHub } from './services/integrations/index.mjs';
const config = await loadIntegrationConfig();
const hub = createIntegrationHub({ config });
const context = { ownerId: authenticatedOwnerId }; // 必须来自平台鉴权结果
const status = hub.status(context);
const result = await hub.probe('spoolman', context);
const inventory = await hub.spools(context);
const tracking = await hub.tracking({ carrier: 'ups', trackingNumber: '...' }, context);
```

状态格式：`{services:[{id,label,state,configured,mode,capabilities,message,lastCheckedAt?}],realPayments:false,realDeviceDispatch:false}`。

- `spools(context)`：`{source:'spoolman',observedAt,spools:[{externalId,name,material,color,remainingGrams,usedGrams,initialGrams,location,archived,source,observedAt,requiresCostConfiguration:true}],truncated}`。缺失剩余重量返回null；不猜采购价。库存预留和同步冲突要在平台同一个数据库事务处理。
- `printers('fdmMonster'|'obico',context)`：设备名称、外部ID、状态和监控摘要；上游IP、令牌、私有摄像头链接不透传。
- `tracking({carrier,trackingNumber},context)`：归一状态、最多200个去重事件、`customerAcceptanceRequired:true,settlementTriggered:false`。
- `rates({shipper,recipient,parcels,carrierIds?},context)`：只查询运价，不购买面单。地址使用Karrio字段 `country_code/postal_code/city/state_code/address_line1/...`；包裹用 `weight/weight_unit/length/width/height/dimension_unit`。未知价格/币种保持null，不能按零价展示。
- `createTestPaymentIntent({orderId,amountCents,currency,idempotencyKey},context)`：仅生成未确认测试意向，金额单位为最小货币单位。`paymentStatus({paymentId,expectedAmountCents,expectedCurrency},context)` 要核对冻结订单；二者不改变平台支付或结算状态。

`services/integrations/catalog.mjs` 的 `unconfiguredStatus()` 可由Worker直接导入，不含Node、文件系统或密钥依赖。

## 真实设备指令账本

`CommandJournal` 使用单独持久SQLite文件，应放在 `data/` 或持久卷。每个工单/设备/指令有唯一键；首次发送前先落盘。多个工单同时请求同一设备启动时，事务内设备互斥会拒绝第二条。`PENDING/ACKNOWLEDGED/UNKNOWN` 都持有设备占用。

- 所有写方法默认关闭。即使管理员配置了 `allowLivePrint:true`，工单还必须是 `mode:REAL`、`paymentState:PAID_VERIFIED`、服务端验签确认付款、无退款争议、工程审核通过，并绑定相同加工文件hash和批准工艺版本。
- 浏览器、客户上传的G-code、演示付款、人工勾选“已付款”都不得形成该资格。v0.9订单流程目前不颁发此真实资格。
- 上传文件名由hash生成，不能覆盖任意设备路径；上传不会启动打印。
- 启动需新鲜设备空闲状态及清台/备料。返回ACK只代表请求响应，不代表打印已开始。
- 启动超时或响应失败记为 `UNKNOWN`；同键调用只返回旧结果，不发送第二次。网关重启后同样生效。
- 解除占用须现场核对后调用 `journal.reconcile`，提供当前指令ID、工单、设备、新鲜空闲观察、清台、操作人和说明；对账证据独立保存。此方法不暴露给公开HTTP接口。

## 可选BullMQ

默认仍使用平台数据库中的任务/租约，适合单机验证。需要独立分布式计算队列时：

```sh
docker compose -f compose.integrations.yaml --profile queue up -d
npm install --prefix services/integrations
```

选配包固定 BullMQ 6.7.2，Redis镜像固定8.10.3（官方2026-10-26稳定发布）；本环境未运行Docker组合验证。`createBullTaskQueue` 仅允许 analysis、slice、schedule、tracking-poll、notification；队列数据只含元数据，不存模型或G-code。任务ID包含owner与平台task ID；重试仍须由平台任务租约和幂等操作保护。保留任务记录，清理前先确认业务账本已完成。队列适配器不会自动把已有平台任务迁移到Redis，也没有启动无人值守的真实设备worker。

## 上游依据与许可

| 项目/许可 | 本次使用方式 | 官方依据 |
| --- | --- | --- |
| Spoolman / MIT | HTTP适配，未复制源代码 | https://github.com/Donkie/Spoolman/tree/master/spoolman/api/v1 |
| Moonraker / GPL-3.0-only | 外部设备服务API | https://moonraker.readthedocs.io/en/latest/external_api/ |
| OctoPrint / AGPL-3.0 | 外部设备服务API | https://docs.octoprint.org/en/main/api/files.html |
| FDM Monster / AGPL-3.0 | 外部实例只读 | https://docs.fdm-monster.net/docs/developer_setup/api_documentation |
| Obico / AGPL-3.0 | 外部实例只读 | https://www.obico.io/docs/api/api-authentication-oauth/ |
| Karrio / LGPL-3.0核心及商业EE | HTTP查询适配 | https://www.karrio.io/docs/developing/shipping-integration |
| Hyperswitch / Apache-2.0 | 测试支付意向API | https://api-reference.hyperswitch.io/ ; https://github.com/juspay/hyperswitch/blob/main/crates/router/src/routes/health.rs |
| BullMQ / MIT核心 | 单独安装的选配队列依赖 | https://docs.bullmq.io/patterns/idempotent-jobs |

Karrio的多租户、审计和SSO部分属于商业EE；本适配器不包含这些代码。容器镜像及将来复制/修改的AGPL/LGPL项目，仍需按实际部署和分发方式履行相应许可义务。配置一个API连接不表示共造已经取得全球支付、资金托管、所有品牌设备控制或所有地区物流能力。

Keycloak 登录接入见 `docs/IDENTITY_V0.9.md` 或 `services/identity/` 中的部署说明；与本文件的服务密钥隔离。
