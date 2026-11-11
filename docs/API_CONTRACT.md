# 本地演示 API 与生产协议草案

本目录是框架验证代码。所有报价参数、农场、模型、付款、物流和结算均为演示。内存数据重启即丢失；没有真实设备控制、用户认证、支付机构或快递连接。金额单位为人民币分，时间为 Unix 毫秒或接口明确标注的小时区间。

## 运行

需要 Node.js 20 或更新版本，不需要安装 npm 包。从仓库根目录运行：

```sh
node services/api/server.mjs
node services/gateway-simulator/demo.mjs
node --test tests/domain.test.mjs
```

API 固定绑定 `127.0.0.1`；可用 `DEMO_API_PORT` 更改默认端口 8787。不得通过公网代理暴露此无认证演示服务。未设置 CORS；网页演示与该 API 当前不自动连接。

## 可运行接口

所有响应均带 `mode: DEMO_ONLY_IN_MEMORY`。所有写订单请求需 `Idempotency-Key`；同一键和不同请求体会被拒绝，重复相同请求返回原结果。当前注册表只在单进程内有效。

| 方法与路径 | 输入 | 返回/作用 |
| --- | --- | --- |
| `GET /health` | 无 | 明确真实支付、真实设备、持久存储均未启用 |
| `GET /api/capabilities` | 无 | 只读、虚构的设备能力与报价参数 |
| `POST /api/quotes` | `modelId`、`material`、`quantity`、`farmId` | 生成不可变报价；客户端传入的金额不被使用 |
| `POST /api/orders` | `quoteId`、`fingerprint` | 校验价格快照并短时预留机器及材料 |
| `GET /api/orders/:id` | 无 | 订单、事件记录、结算准入判断 |
| `POST /api/orders/:id/actions` | `action`、`demoAcknowledged: true` | 显式执行本地状态模拟 |

报价默认使用 `demo-bracket`、`PLA`、数量 1、`demo-farm-a`。材料可选 `PLA/PETG`，农场可选 `demo-farm-a/demo-farm-b`，数量 1–100。几何和工时取自服务端演示 fixture，不解析用户真实文件；不能用此报价承诺商业订单。

报价包含 `quoteId`、`fingerprint`、`modelHash`、`profileVersion`、`recipeVersion`、`amountCents`、`costs`、`eta.shipHours`、`eta.deliveryHours` 与 15 分钟有效期。价格指纹绑定条款；这不是支付机构签名。

动作：

| action | 额外输入及约束 |
| --- | --- |
| `simulate-payment` | 预约仍有效；只设置 `PAID_FROZEN_DEMO`，无资金移动 |
| `simulate-transition` | `nextState`，仅允许领域状态图中的相邻迁移 |
| `simulate-cancel` | 仅未派发或已确认停止的订单；停止后还需 `bedClear: true` |
| `simulate-shipment` | 质检通过后提供以 `DEMO-` 开头的 `trackingNumber` |
| `simulate-delivery` | 模拟已发货包裹送达，独立更新物流状态 |
| `simulate-acceptance` | 物流已送达且 `customerAccepted: true` |
| `simulate-dispute` | 结算前打开争议，阻断后续结算 |
| `simulate-settlement` | 已验收、已送达、模拟付款确认、无争议与退款；不执行支付调用 |

`simulate-transition` 附加门槛：`STARTING` 需 `readinessConfirmed`；`STOP_CONFIRMED` 需 `stopConfirmed`；`QC_PENDING` 需 `partRemoved` 与 `bedClear`；`QC_PASSED` 需 `qcPassed`。这些布尔值是操作者主动模拟，不是设备传感器证明。真正的设备校验在独立网关模拟器中演示，API 尚未和它连通。

正常生产状态：`RESERVED → QUEUED → DISPATCHED → UPLOADED → READY → STARTING → RUNNING → WAITING_REMOVAL → QC_PENDING → QC_PASSED`。

物流状态独立为 `NONE → SHIPPED → DELIVERED`；验收状态独立为 `PENDING → ACCEPTED`。结算必须同时满足生产质检通过、物流送达与客户验收。

异常状态包括 `EXECUTION_UNKNOWN`、`PAUSED`、`CANCEL_REQUESTED`、`STOP_CONFIRMED`、`FAILED`、`QC_FAILED`、`REWORK_REQUIRED`、`CANCELLED`。返工必须创建新生产尝试，不清空原失败历史；此演示尚未实现返工创建端点。预留过期不会自动退款，当前需取消并人工核对。

## 模块边界

`packages/domain/rules.mjs` 是无 Node、浏览器或 I/O 依赖的纯规则，可复用于网页/小程序与服务端；租约令牌由调用方注入。`packages/domain/index.mjs` 是 Node 专用入口，额外提供密码学指纹、UUID、报价生成与内存幂等注册表。前端只能使用纯规则做提示，不能成为交易金额、设备启动或资金状态的信任来源。

## 未来生产协议（设计契约，尚未接入）

1. 商业预约绑定订单、机器时段、材料数量与有效期；付款确认转正式预约。设备派发租约单独保存持有者、令牌和到期时间。
2. 网关只向外建立受认证连接。任务签名绑定订单、生产尝试、设备、租约、报价指纹、模型哈希、机器配置版本、切片配方版本、文件哈希与有效期。
3. 分开执行下载/上传和启动。启动前在本地核验模型和配置一致、设备在线、床面已清理、材料充足、无故障、操作员确认及机型适用的联锁条件。
4. 指令需稳定 `commandId`。开始生产之后收到相同指令返回原执行记录；禁止通过换一个指令 ID 为同一尝试再开机。
5. 开机响应超时进入 `EXECUTION_UNKNOWN`，保留机器占用；不能因心跳/租约超时自动改派。只有核实任务身份和设备状态后才能收敛。
6. 完成打印后仍占用工作台；取件和清台后释放机器，质检记录单独保存。首期不执行自动清台。网关模拟器按机器维护物理占用锁，新的任务、订单或租约均不能覆盖；`reportCompletion` 进入待取件，`confirmClearance` 要求新清台事件，下一任务就绪记录必须匹配该 `clearanceId` 且时间不早于清台确认。
7. 付款/物流 webhook 验签、去重、入库后应答；结算使用支付机构订单状态、平台验收和争议条件共同判断，异步查证结果。

网关模拟器使用 HMAC-SHA256 演示信封验证，不创建任何网络或串口连接，不执行任何 G-code；示例内容是非可执行文本。生产环境应采用设备身份、密钥轮换、持久幂等记录及独立安全评审，不能复用仓库中的演示密钥。

## 错误约定

业务错误返回 HTTP 409 与 `{error:{code,message}}`，如 `QUOTE_EXPIRED`、`MACHINE_UNAVAILABLE`、`IDEMPOTENCY_CONFLICT`、`SETTLEMENT_BLOCKED`。未知路径为 404。该简化错误码体系仅供演示，正式 API 需细分 400/401/403/409/422/429、添加请求追踪号，并发布版本化 OpenAPI 规范。
