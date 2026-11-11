# v0.9 制造与服务接入

本版采用“原有模型需求/商家方案 + 独立计算服务 + 持久生产台账 + 可选服务适配器”。前台保持黑白界面，复杂工艺由商家模板承担。

## 数据和执行边界

- 网页 API 只写纯业务状态；SQLite/D1 CAS 重试不包含网络、切片、支付或设备启动。
- 分析、切片、排期任务记录模型 hash、配置快照、数量、单位和 inputHash。worker 只能领取指定账号和类型的任务。
- 模型原文下载绑定有效 jobId、leaseToken、attempt 和文件 hash。浏览器会话与发现网关凭据不能替代制造服务凭据。
- 空轮询不消耗幂等账本；成功领取、结果回传和库存预留经持久事务核对。过期结果、旧配置、重复生产与超库存均拒绝。
- 任务只存小型元数据。G-code 留在独立运算服务目录，不嵌入工作空间 JSON，不发送到打印机。
- 工艺配置变化使未下单的切片报价失效；已付订单与生产成本快照保持不变。
- 默认生产演练只预留 SANDBOX 库存。Spoolman 观测库存为 LIVE_INVENTORY，记录观测时间及缺失采购价，不能由模拟订单扣减。
- 旧订单动作不能绕过生产中心的实耗/质检和库存预留释放。

## HTTP 接口

| 路由 | 权限与用途 |
| --- | --- |
| GET /api/v2/merchant/operations | 登录并开通商家的 owner 私有生产视图 |
| POST /api/v2/merchant/operations/commands | 商家操作，body 为 type、payload；不接受后台结果命令 |
| GET /api/v2/merchant/integrations | 当前 owner 的脱敏配置/最近探测状态 |
| POST /api/v2/merchant/integrations/probe | service ID；地址和凭据由服务器配置 |
| POST /api/v2/merchant/integrations/sync-spools | 空对象；服务端读取后原子保存最多 100 卷有效库存，报告跳过数 |
| POST /api/v2/merchant/integrations/tracking | carrier、trackingNumber；外部物流观察，不触发结算 |
| POST /api/v2/worker/claim | 独立 bearer，限定任务类型与租约 |
| POST /api/v2/worker/complete、/fail | 独立 bearer 与当前任务租约/attempt |
| GET /api/v2/worker/models/:id/download?jobId=... | bearer + X-Job-Lease + X-Job-Attempt，限该任务模型 |

所有写请求有 Idempotency-Key。生产 JSON 上限 64 KiB，模型 20 MiB，工作空间整体 1 MiB；达到容量时明确拒绝，不静默丢记录。企业规模需要拆分数据库任务/库存表、历史归档及对象存储生命周期，本版未承诺企业容量。

## 推荐试点顺序

1. 本地沙盒完成上传、商家方案、客户确认、库存、生产、质检、发货、验收流程。
2. 配置 Trimesh 运算服务与单一商家白名单 PrusaSlicer 配置，核对实际生成的耗材、机时和版本证据。
3. 采集真实打印订单的机时、耗材和返工记录，以此校准成本及交期；此步由商家现场试验，不自动开启设备。
4. 配置 Spoolman / Karrio 等需要的服务，核对指定账号的数据与承运商覆盖。
5. 配置独立 Keycloak、SMTP、真实多商户市场权限和支付商户资质；真机资格、资金验证、退款/拒付/分账账本完成后，才能开启商业试点。

## 本版明确未宣称的能力

未完成全球支付通道开通、收货后真实分账、所有机型自动接入、自动 CNC CAM/开机、自动打印质量验收、跨客户三维混排、手机商店上架、原生微信生产中心。FDM Monster/Obico 是外部只读适配器；BullMQ 是可选队列适配器，默认运行仍使用平台持久任务。不是将所有上游项目整套搬入共造。

实际测试结果以 VALIDATION.md 的 v0.9 记录为准。外部凭据未配置或硬件未测试的项目应保持 NOT_CONFIGURED / 待验收。
