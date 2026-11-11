# v0.9 生产中心领域接口

生产中心以当前登录账户的工作空间为边界。它为旧 v0.8 数据惰性初始化 `operations`，不执行网络、打印机或支付操作。SQLite/D1 在并发冲突时可重放同一事务，所有外部调用必须放在事务之外。

## 导出

- `getOperations(workspace, now?)`：商家私有视图，返回 `schemaVersion / revision / spools / profiles / jobs / productions / schedule / events / models / orders / devices / summary`。不返回幂等账本及 `leaseToken`。包含商家成本数据，不可拼入客户 `getPublicWorkspace`。
- `applyOperationsCommand(workspace, {type,payload,idempotencyKey}, {now,idFactory,workerId,workerKinds,integration})`：返回 `{workspace,result,replayed}`。新的工作空间为副本；失败不修改原始对象。
- `estimateSliceEconomics(workspace, sliceJob, costCentsPerKg?, frozenPricingProfile?)`：使用整板切片耗材和机时计算成本、目标毛利及每单/每机时利润底线。采购价和计价参数均为商家输入，不是市场价格保证。
- `findSliceEvidence(workspace,{modelId,modelHash,qty,unit,material,farmId,quality})`：只查找当前配置版本对应的 `WORKER / WORKER_OBSERVED / COMPLETED` 切片，返回 `{job,economics}` 或 `null`。模拟结果绝不成为真实切片证据。

## 商家命令

商家 HTTP 层建议统一 `POST /api/v2/merchant/operations/commands`，正文 `{type,payload}`，请求头提供 `Idempotency-Key`。每个新操作必须使用独立幂等键；同一操作重试复用原键。

| type | payload | 结果 |
| --- | --- | --- |
| `save-spool` | `id?`, `expectedRevision`, `name`, `material`, `remainingGrams`, `costCentsPerKg`, `mode` | `spool`；新纪录 revision 从 1 开始 |
| `set-spool-cost` | `id`, `expectedRevision`, `costCentsPerKg` | 只更改采购价，保留外部库存来源与绑定 |
| `save-profile` | `id?`, `expectedRevision`, `name`, `localProfileId`, `engine`, `process`, `material`, `quality`, `farmId`, `deviceId`, `expectedProfileSha256?`, `enabled` | `profile` |
| `queue-job` | `kind`, `modelId?`, `profileId?`, `quantity?`, `unit?`, `mode`, `demoAcknowledged?` | `job`, `alreadyQueued` |
| `cancel-job` | `jobId` | `job`；不能取消完成结果，运行中取消使租约失效 |
| `create-production` | `orderId`, `sliceJobId`, `spoolId`, `demoAcknowledged:true`, `adoptExistingSimulation?` | `production`，原子预留库存 |
| `readiness` | `productionId`, `bedClear:true`, `materialReady:true`, `deviceClear:true`, `loadedMaterial`, `demoAcknowledged:true` | 备机有效期 5 分钟 |
| `dispatch-production` | `productionId`, `demoAcknowledged:true` | 开始模拟生产；真实指令数仍为 0 |
| `finish-production` | `productionId`, `actualMaterialGrams`, `actualDurationSeconds`, `demoAcknowledged:true` | 原子扣减实耗/释放预留，等待取件 |
| `qc-production` | `productionId`, `partRemoved:true`, `bedClear:true`, `passed`, `note?`, `demoAcknowledged:true` | 质检通过/不通过，释放设备占用 |
| `cancel-production` | `productionId`, `demoAcknowledged:true` | 只取消未开始台账并释放预留 |
| `reconcile-production` | `productionId`, `observedState`, `note`, `demoAcknowledged:true` | 仅供 `UNKNOWN` 人工对账 |
| `schedule` | `baseAt?` | 基于当前设备与工时的 FIFO 排期草案 |

材料范围为 `PLA/PETG/ABS/RESIN/ALUMINUM/CNC`。库存单位为克，采购价为人民币分/千克，库存量 0–1,000,000 克，采购价 0–10,000,000 分/千克。库存模式为 `SANDBOX` 或 `LIVE_INVENTORY`。已预留数量不可被手动调减；已有耗材的材料类型和模式不可变更。

工艺配置：`localProfileId` 仅是 1–80 位字母、数字、下划线、连字符的白名单键，不接受文件路径、URL 或任意 G-code。`engine` 为 `PrusaSlicer/FreeCAD`，`process` 为 `FDM/CNC`，`quality` 为 `standard/fine`，当前自动切片仅支持 FDM。`farmId` 使用现有 `f1/f2/f3` 计价产线，旧沙盒设备必须属于相应产线。所有配置 `hardwareVerified:false`，登记配置并不构成真机验收。

## 工作任务与结果

任务种类为 `ANALYZE_MODEL / SLICE_MODEL / SCHEDULE`，模式为 `WORKER / SANDBOX`。`WORKER` 任务持久排队，等待独立计算进程；`SANDBOX` 任务明确标记 `SIMULATED`，由旧几何数据生成演示估算。示例模型没有真实文件，不能领取为真实计算任务。

`workspace.operations.jobs[]` 关键字段：

```json
{
  "id": "job-…",
  "kind": "SLICE_MODEL",
  "mode": "WORKER",
  "status": "LEASED",
  "inputHash": "sha256 of immutable job terms",
  "modelId": "mdl_…",
  "modelHash": "sha256 of uploaded bytes",
  "modelVersion": 1,
  "profileId": "profile-…",
  "profileRevision": 1,
  "configSnapshot": {},
  "quantity": 1,
  "unit": "mm",
  "workerId": "configured-worker",
  "leaseToken": "lease-…",
  "leaseUntil": 1794240300000,
  "attempt": 1
}
```

后台专用命令必须由 HTTP 认证层注入 `context.workerId`，不能从客户提交正文取得。可附加 `workerKinds` 限制任务范围。

| type | payload | 校验 |
| --- | --- | --- |
| `claim-job` | `kinds?`, `leaseSeconds?` | 30–900 秒；只领取 WORKER 排队任务；返回带租约的 `job` 或 `null` |
| `complete-job` | `jobId`, `leaseToken`, `attempt`, `result` | worker 身份、当前租约、次数和未过期同时匹配 |
| `fail-job` | `jobId`, `leaseToken`, `attempt`, `errorCode`, `errorMessage` | 同租约检查，失败不自动反复执行 |
| `expire-leases` | 空对象 | 分析/切片过期重新排队，最多 3 次；派单未知进入 UNKNOWN |

无任务轮询且没有过期变更时返回不落库的 no-op outcome，不消耗操作账本。重复领取请求在原租约过期或状态变化后返回 `job:null, staleClaim:true`，不返回已失效的旧租约。下载模型也必须由 HTTP 层检查相同租约和所属账户。

结果公共字段：`inputHash/modelHash/profileRevision/engineVersion/provenance`，其中 `provenance` 必须是可信后台的 `WORKER_OBSERVED`。分析结果 `geometry`：`dimensionsMm[3], volumeMm3|null, surfaceAreaMm2, watertight, windingConsistent, isVolume, bodyCount, faceCount, requiresReview, warnings[]`。

切片结果额外需要 `durationSeconds/materialGrams/artifactHash/profileSha256`，可提供 `plateCount` 和 `geometry`。配置登记了文件 SHA-256 时必须匹配。结果不包含大文件或 G-code 本体，避免工作空间过大。任务完成后若模型或配置版本变化则拒绝接收；已付订单的报价快照不被后台结果覆盖。

排期任务由服务器生成 `configSnapshot:{baseAt,tasks:[{jobId,deviceId,durationSeconds,createdAt}]}`。结果为 `schedule:[{jobId,deviceId,startAt,endAt}],solverStatus`；所有时间为毫秒 epoch。必须覆盖全部任务、设备一致、工时足够、同一设备不重叠，任务集合变化后拒绝过期结果。排期是建议，不是物流时效承诺。

## 外部库存同步

`sync-spools` 仅允许 `context.integration === 'spoolman'`。正文 `{spools:[{externalId,name,material,remainingGrams,costCentsPerKg?}]}`，数据须由后台连接读取，不接受浏览器冒充。同步记录为 `source:SPOOLMAN, mode:LIVE_INVENTORY`，人工不能在共造覆盖原库存。未知成本保存为 `costCentsPerKg:null, costConfigured:false`，不可当作零成本。商家可通过 `set-spool-cost` 单独填写采购价，后续同步保留 `costSource:MERCHANT_ENTRY` 的手工价格。无法映射的材料应由连接层说明并过滤，不应偷偷替换成 PLA。

当前生产演练只预留 `SANDBOX` 库存，绝不扣减真实 Spoolman 库存。

## 生产状态与旧数据

生产台账为 `AWAITING_READINESS → READY → PRINTING → WAITING_REMOVAL → QC_PASSED/QC_FAILED`。已发货、已验收、退款中或争议中的订单不能重新生产。同一订单只能建立一个台账；多个不同请求键不能绕过此约束。

旧流程已模拟打印的订单必须显式确认 `adoptExistingSimulation:true` 才能迁入：只迁移沙盒记录，释放旧演示设备占用，回到待备机状态，并记录事件。生产台账开始后，旧履约入口不得再次控制该设备或重复扣减库存。

创建台账时冻结切片、采购价和计价配置。完工实耗按冻结单价计算；风险预留仅用于报价估算，不列为实际已花成本。实际利润是商家记录与沙盒收入基础上的核算，不代表真实支付或已结算利润。

## 容量与当前边界

- 本版本最多 100 卷耗材、50 个工艺配置、180 个计算任务、100 个生产台账、1500 个非空写操作幂等记录；工作空间仍有数据库的 1 MiB 上限。
- 当前仅接入真实计算证据及外部库存读取；所有设备启动和款项流转保持关闭。
- 配置身份、支付账户、真机验收和现场联锁完成后，才能另行启用真实派单。不能以 `SIMULATED_FROZEN` 作为真实设备授权。
- 所有纯事务失败均不修改库存或订单。生产中心的私有成本、租约和后台配置不可发送给客户视图。
