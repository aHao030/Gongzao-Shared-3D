# 共造 v0.6 客户与履约沙盒 API（/api/v2）

本文件描述 `services/platform` 当前实现；机器可读契约为 [openapi-v2.json](./openapi-v2.json)。旧 [API_CONTRACT.md](./API_CONTRACT.md) 描述独立的 v1 内存演示，不能用作当前网页的接口说明。

## 能力范围

v0.4 提供按 owner 隔离的客户资料与收货地址、服务端工作空间、原始文件保存与下载、STL 几何分析、服务端报价快照、订单状态迁移及持久幂等记录。农场、设备、价格、付款、物流、验收和结算都是沙盒数据：**没有真实支付、设备控制、切片器、快递查询或微信登录接入**。成功写入响应固定携带 `physicalCommandsSent: 0`、`moneyTransferred: 0`。

一个 owner 可在自己的沙盒内同时执行客户与农场操作；这是流程验证权限，**不是已实现的多商户 RBAC 或独立交易双方认证**。`complete-print`、`deliver` 等动作是操作者推进模拟，不是可信设备事件或承运商回调。

## 运行与身份

仓库要求 Node.js 24 或更新版本。本地运行 `npm start`，默认地址 `http://127.0.0.1:3000`，默认数据库为 `data/platform.sqlite`；`DATA_PATH` 可改变数据库路径。持久化实现是 SQLite；托管 Worker 使用 D1 保存工作空间与 R2 保存文件，分别要求 `DB`、`BUCKET` 绑定。

| 部署 | 身份来源 | 行为 |
| --- | --- | --- |
| 本地服务 | `coforge_sandbox` Cookie | 首次 `GET /api/v2/session` 创建随机 owner 与 30 天会话。Cookie 为 HttpOnly、SameSite=Strict、Path=/；本地 HTTP 不设置 Secure。后续请求携带同一 Cookie。会话没有用户账户恢复能力，丢失 Cookie 不会自动找回原空间。 |
| 托管 Worker | 托管认证入口注入的 `oai-authenticated-user-id` | Worker 使用该可信身份区分空间；客户端不得把自行填写此头当作登录。部署必须保留能够验证并覆盖身份头的认证入口。没有该身份时 API 返回 401。 |

本地 Host 仅接受 `127.0.0.1`、`localhost`、`terminal.local`。API 拒绝 `Sec-Fetch-Site: cross-site`，也拒绝存在但与请求 URL origin 不同的 `Origin`；当前没有跨域调用配置。此同源检查不等于商业权限系统。

`GET /health` 在存储已配置时不要求 owner。托管缺少 `DB` 或 `BUCKET` 时，包括 health 在内的 API 请求先返回 `503 STORAGE_UNAVAILABLE`。

## 请求与响应约定

- 所有 POST 必须带 `Idempotency-Key`，匹配 `^[A-Za-z0-9_.:-]{8,128}$`。GET 不要求该头。
- 同一 owner 内，键绑定命令类型及规范化 payload。相同请求重放返回缓存结果与 `replayed: true`；同键不同请求返回 `409 IDEMPOTENCY_CONFLICT`。不要给失败重试换新键。
- 重放响应中的业务结果来自首次成功执行，`workspace` 是当前空间快照；两者时间可能不同。模型和订单 POST 重放仍返回 HTTP 201。
- POST 成功响应：`mode: SERVER_SANDBOX`、命令结果、`workspace`、`replayed`、`requestId`、`physicalCommandsSent: 0`、`moneyTransferred: 0`。结果内部的报价 `mode` 仍为 `DEMO_ONLY`。
- GET session/workspace/health 返回各自数据结构，不保证有 `requestId`。公共 `workspace` 仅含 `customerProfile`、`revision`、`orders`、`devices`、`models`，不返回报价集合、幂等台账或文件存储键。
- JSON POST 使用 `Content-Type: application/json`，最大 **32,768 字节**，请求体必须为 JSON 对象。模型上传使用原始文件字节，见下文。
- 金额以 `*Cents` 的人民币分为计算依据；`total` 和费用展示字段是元。时间戳 `issuedAt/expiresAt/createdAt` 等为 Unix 毫秒；`created`、事件 `time` 是 ISO 8601。
- 未声明的 JSON 字段目前不会统一拒绝，但不应依赖它们产生业务效果。服务端不信任客户端提供的金额、几何、付款状态或设备状态。

## 路由

| 方法与路径 | 输入 | 成功结果 |
| --- | --- | --- |
| `GET /health` | 无 | HTTP 200：`ok`、`version: 0.4.0`、`mode`、`persistence`、`realPayments: false`、`realDevices: false` |
| `GET /api/v2/session` | 部署身份/本地 Cookie | HTTP 200：`authenticated`、`user: {id,label}`、`persistence`、`capabilities`；本地首次可建立会话 |
| `GET /api/v2/workspace` | 部署身份/本地 Cookie | HTTP 200：公共空间快照 |
| `GET /api/v2/customer/profile` | 部署身份/本地 Cookie | HTTP 200：`profile`；未建资料为 `null` |
| `POST /api/v2/customer/profile` | 完整资料、地址或 `null`、幂等键 | HTTP 200：`profile` 与当前空间快照 |
| `POST /api/v2/models` | 原始文件、`X-File-Name`、幂等键 | HTTP 201：`model` 与空间快照 |
| `GET /api/v2/models/{modelId}/download` | 已上传文件的 `mdl_…` ID | HTTP 200：`application/octet-stream`，UTF-8 下载文件名；只访问当前 owner 的文件 |
| `POST /api/v2/quotes` | 模型与制作选项、幂等键 | HTTP 200：`quotes`，当前目录生成 3 家虚构农场报价 |
| `POST /api/v2/orders` | `quoteId`、`demoAcknowledged: true`、幂等键 | HTTP 201：`order` 与空间快照 |
| `POST /api/v2/actions` | `action`、动作参数、`demoAcknowledged: true`、幂等键 | HTTP 200：`order` 和/或 `device`，或 `reset: true`，以及空间快照 |

没有独立的 v2 `GET /orders/{id}`、支付 webhook、物流 webhook 或真实生产指令端点；订单查询从工作空间快照读取。另有商家资料和只读发现网关接口，见 [商家指南](MERCHANT_GUIDE.md)，不代表正式商家认证或真实打印能力。

## 客户资料与收货地址

用户登录或本地会话建立后，客户端调用 `GET /api/v2/customer/profile`；旧空间没有资料时返回 `{"profile":null}`，不会自动填入“华东”或虚构收货地址。此资料表单是应用内首次资料完善，不是新建支付账户或独立身份认证。

保存资料示例（POST `/api/v2/customer/profile`，同时带 `Idempotency-Key`）：

```json
{
  "displayName":"示例创作者",
  "setupCompleted":true,
  "shippingAddress":{
    "recipient":"测试收件人","phone":"13800000000","countryCode":"CN",
    "province":"浙江省","city":"杭州市","district":"西湖区",
    "addressLine":"测试路1号","postalCode":""
  }
}
```

这些是虚构测试资料，不得当成真实配送信息。

| 字段 | 校验与含义 |
| --- | --- |
| `displayName` | 必须是字符串，去首尾空格后 0–80 字符；空字符串可用，不是登录凭证 |
| `setupCompleted` | 必须是布尔值；首次选择稍后填写可提交 `true`，避免每次打开首页自动重复弹窗 |
| `shippingAddress` | 必须显式提供；`null` 表示暂未填写或清空默认地址，不能进行报价 |
| `recipient` | 1–80 字符，收件人 |
| `phone` | 最多 40 字符；只允许数字、首位 `+`、空格、括号、短横线，有效数字 5–20 位；未进行短信验证 |
| `countryCode` | 两个英文字母，服务端转为大写；本轮未使用国家地址核验服务 |
| `province`、`city` | 各 1–80 字符；CN 的省区市须为支持的 31 个大陆省级地区，常见去后缀别名归一为标准全名 |
| `district` | 最多 80 字符，CN 必填；其他国家/地区可为空或省略 |
| `addressLine` | 1–240 字符，详细地址 |
| `postalCode` | 可为空或省略，最多 20 字符 |

地址中的文本字段去首尾空格并拒绝控制字符。有效的文本不表示地址已通过邮政、地理或物流可达性验证。资料由同一 owner 的 SQLite/D1 工作空间保存；不会发往地图、物流或支付服务。

响应 `profile` 包含上述字段，以及 `addressRevision`、`destination`、`createdAt`、`updatedAt`。地址首次填入后版本为 1；任一规范化收货字段变化（含电话、收件人、详细地址、邮编和清空）都会递增版本，改显示名称不递增。`destination` 由服务端推导，客户端提交同名字段不会覆盖计算结果：

| 费用区域 | CN 省区市 |
| --- | --- |
| `east` | 上海、江苏、浙江、安徽、福建、江西、山东 |
| `south` | 广东、广西、海南 |
| `north` | 北京、天津、河北、山西、内蒙古 |
| `other` | 其他已支持的大陆省区市，以及全部非 CN 地址；当前转工程询价确认 |

没有收货地址时 `destination` 为 `null`。`POST` 是完整资料替换，不是字段补丁；重试原幂等键可能返回首次结果，客户端应以响应 `workspace.customerProfile` 的当前版本为准。重置演示订单保留客户资料和默认收货地址。

## 文件上传与分析

上传头为 `Content-Type: application/octet-stream` 和 `X-File-Name: <encodeURIComponent(文件名)>`。不使用 multipart，也不接受 JSON 几何元数据代替文件。文件名会被 NFC 规范化、移除控制字符、截断至 180 个字符；不允许路径分隔符。

支持扩展名 `stl/step/stp/3mf/png/jpg/jpeg/webp`。单文件上限 **20 MiB（20,971,520 字节）**，不能为空。服务端根据原始字节计算 SHA-256，再用内容哈希及规范化文件名生成 `mdl_` 开头 ID。同名且同内容重复上传复用模型记录；相同内容不同文件名生成不同 ID。

STL 支持精确长度匹配的二进制 STL 与 ASCII STL：ASCII 限 **8 MiB**，两者均限 **50,000 个三角面**。服务端计算包围盒、带符号体积的绝对值和边拓扑闭合条件；非法坐标、无效三维尺寸及格式不完整会被拒绝。检查没有覆盖自相交、最小壁厚、公差、支撑或真实可制造性。

当前 `STEP/STP/3MF/图片` 仅保存原始内容与哈希，不解析 CAD/压缩包/图像几何，不做完整文件格式鉴真，均设置 `review: true`。客户端必须展示“待工程审核”，不能将其当成可自动生产模型。

`Model` 的关键字段：`id/name/size/sha256/format/version/createdAt/isSample/geometrySource/unit/dimensions/volume/closed/review/faceCount`。原始 STL 坐标暂按 mm 记录，`volume` 按该假设以 cm³ 计；客户在报价时选择 `inch` 会将各尺寸乘 25.4、体积乘 25.4³，并不改写已保存原始文件。v0.5 新模型持久保存 `analysisVersion`、`analysisNote`；历史模型可能缺少字段，不能据此推断已经验证可制造性。

`sample-bracket` 是服务端演示 fixture，带演示几何而没有可下载原始文件。下载仅对实际上传的 `mdl_…` 路由开放，不应为样例构造下载链接。

## 报价与订单

先保存完整收货地址，再进行报价。无地址时返回 `409 ADDRESS_REQUIRED`；前端弹出补填窗口并在保存成功后继续费用测算。报价请求示例：

```json
{"modelId":"sample-bracket","material":"PLA","quality":"standard","qty":1,"unit":"mm"}
```

| 参数 | 允许值与默认值 |
| --- | --- |
| `modelId` | 当前 owner 的模型；默认 `sample-bracket` |
| `material` | `PLA/PETG/ABS/RESIN/ALUMINUM/CNC`；默认 `PLA` |
| `quality` | `standard/fine`；默认 `standard` |
| `qty` | 1–50 的整数；默认 1 |
| `unit` | `mm/inch`；默认 `mm` |
| `destination` | 建议省略，由保存的收货地址推导；若旧客户端提交则必须与服务端值完全一致，否则 `409 DESTINATION_MISMATCH`，没有默认 `east` |

除 `destination` 外，`null` 与缺省制作参数使用对应默认值。`destination:null` 也会被拒绝，客户端不能覆盖账号地址所对应的费用区域。报价依照服务器目录与已保存的几何计算，不运行实际切片。PLA/PETG、闭合 STL、正体积、各边不超过 250 mm、指定内地区域才可进入自动流程模拟；其他情况返回 `review: true`，原因码为 `MODEL_REVIEW/PROCESS_REVIEW/DESTINATION_REVIEW/GEOMETRY_REVIEW/PLATE_LAYOUT_REVIEW` 的组合。v0.6 会在演示 250 mm 平板的边缘余量和件间距下估算可放件数，无法形成网格时转审核。

每条新报价包含 `quoteId/version/farm/modelId/modelHash/modelVersion/profileVersion/recipeVersion/issuedAt/expiresAt/fingerprint/addressRevision/addressFingerprint`、制作选项、重量/工时/排队量、费用分项及交期区间。有效期为 **15 分钟**。地址指纹为规范化地址的 SHA-256，仅用于版本一致性校验，不代表地址脱敏或真实性认证；报价本身不复制完整地址。`farm` 为对象，而订单 `farm` 为农场 ID。**报价 `material` 是材料费用（元），材料类型请读取 `materialKey`；订单 `material` 才是材料类型。**

v0.6 的 `weight` 为单件几何估重，`hours` 为整批机时除以件数的均值；`productionHours` 为各板预计挤出机时加预热时间之和，`queueHours` 当前累计该农场所有 PRINTING/QUEUED 订单的完整估算工时，不扣除已生产时间。`days` 是沙盒总到货天数区间，`transitDays` 是物流天数区间，`preparationDays` 是额外备机天数。它们不是精确时间承诺或物流预测。审核报价金额为 0、`transitDays` 为空；0 代表未定价，不代表免费，审核报价的 `days` 不应展示为承诺交期。

创建订单只需 `{"quoteId":"Q-…","demoAcknowledged":true}`。服务端核验报价存在、未过期、未使用、指纹和模型版本一致，以及当前地址版本和地址指纹一致。地址变化返回 `409 ADDRESS_CHANGED`，清空地址返回 `409 ADDRESS_REQUIRED`，必须重新补填或测算。新订单保存不可变的 `shippingAddress` 与 `addressRevision` 快照；以后修改默认地址不会改写已下单的收货信息。旧订单不补造地址，升级前的旧报价不能用于新建订单。无需提交报价指纹、金额或客户端计算结果。成功后报价只允许创建一笔订单；同键重试可取回原订单。

自动流程订单直接设置 `SIMULATED_FROZEN`，符合备机条件时可立即模拟开工；审核单为 `REVIEW_REQUIRED/UNPAID`。不存在真实支付步骤，不能将该状态接到生产设备上。

## 动作输入与准入

全部动作都要求 `demoAcknowledged: true`。除 reset 外都要求 `id`；前三个设备动作的 `id` 是 `p1/p2/p3`，其余动作的 `id` 是订单 ID。

| action | 额外必填字段 | 实际准入与效果 |
| --- | --- | --- |
| `reset` | `confirm: "RESET_DEMO"` | 重置订单、设备、报价、模型元数据为初始演示空间；保留客户资料/收货地址、商家资料/设备登记、幂等台账与 revision 递增，不清理文件字节或会话。 |
| `complete-print` | 无 | 设备必须正在打印且占用与订单匹配；进入 `WAITING_REMOVAL`，设备仍被占用。 |
| `prepare-device` | `bedClear: true`、`materialReady: true`、`loadedMaterial: "PLA"或"PETG"` | 设备必须 ready/maintenance 且无占用；备机并尝试派发下一单。 |
| `set-device-paused` | `paused: true` | 仅空闲且未占用设备可暂停接单；进入 maintenance。`paused: false` 不恢复，恢复应调用 prepare-device。 |
| `collect-and-qc` | `partRemoved: true`、`qcPassed: boolean`、`bedClear: true`、`materialReady: true`、`loadedMaterial` | 订单须 WAITING_REMOVAL 且占用对应；设置 QC_PASSED 或 QC_FAILED，释放设备并尝试下一单。 |
| `ship` | `carrier`、`trackingNumber` | 订单须 QC_PASSED 且未发货。承运商非空且不超过 80 字符；运单匹配 `^DEMO-[A-Za-z0-9-]{3,27}$`。 |
| `deliver` | 无 | 仅 SHIPPED 订单可模拟物流送达；不自动验收或结算。 |
| `accept` | `customerAccepted: true` | QC_PASSED、DELIVERED、SIMULATED_FROZEN、验收待定、未请求结算且无争议退款时，仅设置 ACCEPTED/READY；款项继续 SIMULATED_FROZEN，不转账。 |
| `dispute` | `open: boolean` | 已模拟付款、未取消、未提交结算（NOT_REQUESTED/READY/FAILED）；打开或撤销争议，同状态重复操作返回 NO_STATE_CHANGE（同幂等键重放除外）。 |
| `cancel` | 无 | 仅 REVIEW_REQUIRED 或 QUEUED 可取消；冻结的模拟款保持冻结并生成 REQUESTED 退款，须另行处理；尝试调度后续队列。 |

派发按农场选择最早 QUEUED 单；要求设备 ready、无占用、清台、材料就绪、已装材料及配置/配方版本匹配。当前不跳过队首不兼容订单；可能返回/记录 `READINESS_REQUIRED/MATERIAL_MISMATCH/PROFILE_MISMATCH/FUNDS_BLOCKED` 阻塞原因。不会向物理设备发送命令。

生产、付款、物流、验收、结算、争议、退款分别保存在 `productionState/paymentState/logisticsState/acceptanceState/settlementState/disputeState/refundState`。`status` 是界面投影；`dispute` 是争议布尔投影，不能代替完整状态。事件包含 `label/time/at/simulated: true`。

## v0.5 报价证据与资金处理

新报价增加 `estimation`，一同纳入报价指纹。自动沙盒报价标记 `GEOMETRY_HEURISTIC/UNVERIFIED`，`slicer:null`、`machineValidated:false`、`capacityReserved:false`，不意味着已经切片、实机验证或预约产能。`analysisVersion/analysisNote`、排队单数、阶段估算及假设说明用于解释金额和交期。`estimatedArrival` 是报价时刻加预计日数得到的 ISO 日期区间，未使用工作日历；工程审核报价此字段和 `stages` 均为 null，不承诺交期。

验收、结算申请、结算结果分别执行，均只操作沙盒：

| action | 输入 | 效果 |
| --- | --- | --- |
| `request-settlement` | `id` | 客户 ACCEPTED、资金仍冻结、状态 READY/FAILED、无争议或待退款时，创建 `settlementAttempt`，状态 REQUESTED。 |
| `resolve-settlement` | `id,attemptId,outcome`；失败还须 `reason` | attemptId 必须等于当前申请。succeeded → SIMULATED_SETTLED/SIMULATED_RELEASED；failed → FAILED，保留冻结，可重新申请。不代表银行到账。 |
| `request-refund` | `id,reason`；可省略 `amountCents` | 仅模拟已付款、未提交结算时申请整单退款，生成 `refundRequest`。金额若传入须等于订单总额。 |
| `resolve-refund` | `id,requestId,approved`；拒绝还须 `reason` | requestId 必须等于当前退款申请。批准要求设备不再被本单占用；拒绝保留付款且不自动关闭争议。已取消的已付款订单不可拒绝退款。 |

所有新动作仍需 `demoAcknowledged:true` 与 Idempotency-Key。退款请求暂停后续派发、发货与结算，**不会自动停止运行中的机器**；先完成模拟打印、取件释放设备后才允许批准退款。争议也阻止派发、发货与结算。已退款订单不能发货或结算；历史生产/物流事实保留，不能用退款抹去已发货记录。本轮未实现实际退货运输或部分退款。

`settlementAttempt.id` 与 `refundRequest.id` 绑定每次处理结果。失败/拒绝后新申请有新 ID，旧结果被拒；旧幂等键重放只返回原结果，不重新执行。以前的已完成申请保存至 `settlementHistory/refundHistory`。这不是支付机构验签 webhook 或会计账本。

新增展示状态：`accepted`（已验收待结算）、`settling`（结算申请处理中）、`settlement_failed`、`refund_pending`、`refunded`。以独立状态字段决定动作，不能只依赖展示状态。v0.4 已结算/已退款订单仍保留原事实；不把旧记录重做结算。

## v0.6 批量计价与商家收益保护

`GET /api/v2/merchant/pricing` 返回当前 owner 的 3 个演示农场成本配置、最近 60 个报价的内部成本/利润测算和订单收益记录。需要先开通商家工作台；不是多个真实商家的权限系统。

`POST /api/v2/merchant/pricing` 输入为 `{farmId,expectedRevision,profile,demoAcknowledged:true}`，仍需 Idempotency-Key。profile 为完整替换，只接受 OpenAPI 中列出的成本字段；`expectedRevision` 防止旧页面覆盖新配置。同值保存不增加配置版本，实际修改递增版本。新报价绑定 `pricingVersion/pricingRevision`；配置改变后旧版未用报价下单返回 `PRICING_CHANGED`，已创建订单保留旧报价及收益快照。

成本输入包括 PLA/PETG 每千克采购价、设备折旧维护时价、电价/平均功率、人工时价、每单准备分钟、每板准备分钟、逐件后处理分钟、包装费和成本风险预留比例。出料速度和每板预热时间为可调整演示假设，不能当真实切片数据。`riskReserveBps` 是成本预留加成，不是统计失败率。

`batch` 记录 250×250 mm 演示平板、5 mm 边缘余量和 5 mm 间距、每板最多件数、预计板数、各板件数、平面旋转候选与 `verified:false`。不验证支撑、裙边、工具头碰撞、实际切片与清台；不跨客户合板，也不会为凑板无限等待。

设 C 为本批预测成本、H 为本批预计占机小时、r 为目标利润率、L 为最低订单利润、h 为最低每设备小时利润，商家制造收入为：

`max(ceil(C/(1-r)), C+L, C+ceil(H*h))`，货币按整数分计算。利润率分母为商家制造收入，不能按成本加价率解释。三道底线只约束基于输入成本的预测报价，不保证实际经营利润。默认参数全为 `DEMO_ASSUMPTIONS`，不是行业平均。

公开 `pricingSummary` 只含销售金额：`manufacturingCents/platformFeeCents/shippingCents/merchantReceivableCents/customerTotalCents/averageUnitManufacturingCents`。平台费按制造价 7% 向上到分另加；商家应收=制造收入+运费；客户总款=商家应收+平台费。均价四舍五入，仅供展示，不能以均价再乘件数作为扣款额。旧材料/机时/后处理字段为制造销售金额的兼容分配，不是内部成本。

内部 `pricingProfiles/pricingEvidence/profileSnapshot/costBreakdown/estimatedProfitCents` 不出现在客户端 workspace、报价或订单接口，仅通过本 owner 的商家计价接口读取。客户可见平台服务费与制造价，因此这不是对交易金额的隐藏。

新订单保存 `settlementBreakdown`：来源 `V0_6_QUOTE`，结算申请金额只用 `merchantReceivableCents`；退款仍以客户原始 `totalCents` 为全额。旧未结算订单可依据可校验的报价费用推导 `LEGACY_DERIVED`，缺失分项则拒绝自动结算。旧 REQUESTED 总额结算必须先记录模拟失败再重提商家净额，不能直接成功；旧 SIMULATED_SETTLED 历史记录不补造或重算。字段、金额及状态互相校验，模拟流程依然不转账。

完整示例和假设见 [批量计价说明](BATCH_PRICING_V0.6.md)。

## 错误与容量

处理器错误结构为 `{"error":{"code":"…","message":"…"},"requestId":"…"}`。本地外围 Host/资源错误与 Worker 存储绑定错误可能不带 requestId。

| HTTP | 代表错误码 |
| --- | --- |
| 400 | `IDEMPOTENCY_REQUIRED`、`INVALID_JSON`、`INVALID_PAYLOAD`、`INVALID_FILENAME`、`EMPTY_FILE`、`INVALID_CONFIGURATION`、`INVALID_QUANTITY`、`UNKNOWN_ACTION`、`INVALID_TRACKING`、`INVALID_PROFILE`、`INVALID_ADDRESS` |
| 401 | `AUTH_REQUIRED` |
| 403 | `CROSS_ORIGIN_DENIED`、本地 `INVALID_HOST` |
| 404 | `NOT_FOUND`、`MODEL_NOT_FOUND`、`FILE_NOT_FOUND`、`QUOTE_NOT_FOUND`、`ORDER_NOT_FOUND`、`DEVICE_NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED`；不匹配有效 GET 路由的请求也可能落入此分支 |
| 409 | `ADDRESS_REQUIRED`、`ADDRESS_CHANGED`、`DESTINATION_MISMATCH`、`IDEMPOTENCY_CONFLICT`、`QUOTE_EXPIRED`、`QUOTE_USED`、`QUOTE_CHANGED`、`MODEL_CHANGED`、`DEVICE_OCCUPIED`、`READINESS_REQUIRED`、`SETTLEMENT_BLOCKED`、状态准入错误及操作容量错误、`CONCURRENT_UPDATE` |
| 413 | `BODY_TOO_LARGE`、`ASCII_STL_TOO_LARGE`、`MODEL_TOO_COMPLEX`、`WORKSPACE_CAPACITY` |
| 415 | `INVALID_CONTENT_TYPE`、`UNSUPPORTED_FORMAT` |
| 422 | `INVALID_STL`、`INVALID_COORDINATE`、`INVALID_DIMENSIONS` |
| 500 | `INTERNAL_ERROR` |
| 503 | 托管外围 `STORAGE_UNAVAILABLE` |

每个空间逻辑上限：100 个模型（含样例）、500 笔订单、6,000 份报价、2,000 个成功操作幂等键；整个工作空间 JSON 另限 1 MiB，实际可能先触及该字节上限。reset 不清空幂等台账，因此不能绕过操作容量。SQLite 使用事务保存模型元数据与文件；D1 使用 revision 比较更新，R2 文件先写、元数据后提交，不是跨 D1/R2 原子事务。并发失败应使用原幂等键重试。

## 最小调用示例

以下命令面向本地沙盒，使用新的幂等键运行每个新业务请求：

```sh
curl -c /tmp/coforge-cookie.txt http://127.0.0.1:3000/api/v2/session
curl -b /tmp/coforge-cookie.txt http://127.0.0.1:3000/api/v2/workspace
curl -b /tmp/coforge-cookie.txt -X POST http://127.0.0.1:3000/api/v2/models \
  -H 'Content-Type: application/octet-stream' -H 'X-File-Name: cube-20mm.stl' \
  -H 'Idempotency-Key: upload-example-001' --data-binary @tests/fixtures/cube-20mm.stl
curl -b /tmp/coforge-cookie.txt -X POST http://127.0.0.1:3000/api/v2/customer/profile \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: profile-example-001' \
  --data '{"displayName":"测试用户","setupCompleted":true,"shippingAddress":{"recipient":"测试收件人","phone":"13800000000","countryCode":"CN","province":"浙江省","city":"杭州市","district":"西湖区","addressLine":"测试路1号","postalCode":""}}'
curl -b /tmp/coforge-cookie.txt -X POST http://127.0.0.1:3000/api/v2/quotes \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: quote-example-001' \
  --data '{"modelId":"sample-bracket","material":"PLA","qty":1}'
```

从返回 `quotes` 中选择 `quoteId` 后调用 orders；从返回空间读取设备与订单实际 ID 再调用 actions。不得把这些示例请求连接到真实付款或设备启动流程。
