# 跨端 API v2 客户端

`api-client.js` 是无平台依赖的客户端工厂。Node/CommonJS 可 `require`；打包器可按 CommonJS 导入；浏览器以脚本加载时导出 `globalThis.SharedFabricationApi`。这里提供的是接口与传输适配能力，不是已接通的原生登录。

微信无法直接依赖其项目根目录外的文件，因此 `apps/weapp/utils/api-client.js` 是带来源标记的生成副本。修改源文件后执行：

```sh
node apps/tools/sync-client.mjs
node apps/tools/sync-client.mjs --check
node --test apps/tests/*.test.mjs
```

## 身份与地址

- `apiBase` 只能是 HTTPS origin，例如开发者自己的后端域名；不包含 `/api/v2`、查询参数、账号或片段。
- `transport(request)` 必须返回 `{ status, data }` 或 `{ statusCode, data }`。
- `getAccessToken()` 由平台的真实登录适配器注入。没有令牌时在发送网络请求前失败。
- 当前托管服务只接受 Sites 身份；微信、Capacitor 和 Tauri 尚无兼容的登录/令牌交换实现。不能把这里的 Bearer 头直接当作 Sites 身份头，不能复制 ChatGPT Cookie 或在代码中硬编码令牌。
- `createFetchTransport(fetchImpl)` 明确设置 `credentials: 'omit'`。微信使用 `wx.request` transport。
- 服务端模式必须先调用 `getSession()`，只接受 `authenticated: true` 且 `mode: 'SERVER_SANDBOX'`。本客户端不用于连接真实付款/设备的生产模式。

## 接口契约

| 方法 | HTTP | 关键输入 / 返回 |
|---|---|---|
| `getSession()` | `GET /api/v2/session` | 校验沙盒模式与认证；返回 user/persistence 等服务端信息 |
| `getWorkspace()` | `GET /api/v2/workspace` | 返回 `workspace`，包含 revision/orders/devices/models |
| `getCustomerProfile()` | `GET /api/v2/customer/profile` | 返回 profile 或 null；包含 shippingAddress/addressRevision/destination |
| `saveCustomerProfile(input, key)` | `POST /api/v2/customer/profile` | 保存 displayName、setupCompleted 与 shippingAddress；返回 profile/workspace |
| `getQuotes(input, key)` | `POST /api/v2/quotes` | input 含 modelId/material/quality/qty/unit；配送地区由服务端账号地址推导，返回 quotes/workspace |
| `createOrder(quoteId, key)` | `POST /api/v2/orders` | 自动带 `demoAcknowledged: true`；返回 order/workspace |
| `uploadModel(bytes, filename, key)` | `POST /api/v2/models` | 原始二进制，`application/octet-stream`，编码后的 `X-File-Name` |
| `customerAction(action, id, extra, key)` | `POST /api/v2/actions` | 仅 accept/dispute/cancel/request-refund；不能调用商家生产、退款审批或结算操作 |

所有 POST 均需要 `Idempotency-Key`（8–128 位字母、数字或 `_.:-`）。一次操作及其重试必须复用同一个键；成功后新的用户操作再生成新键。网络失败不会被转换成本地成功。微信 adapter 将尚未确认完成的报价/创建订单幂等键保存在本机，直至收到成功响应；它不把令牌写入该存储。

客户动作需提供实际业务字段：`accept` 使用 `{ customerAccepted: true }`，`dispute` 使用 `{ open: true }` 或 `{ open: false }`，`cancel` 不需额外业务字段；`request-refund` 使用 `{ reason: "退款说明" }`。验收只进入待结算，不表示资金已释放或银行到账。服务端仍负责权限、状态条件和幂等校验。当前小程序远端订单页只读，尚未将这些动作连接到按钮。

模型上传只提供底层接口，小程序页面仍仅使用内置示例。不要据此声称小程序已实现真实文件上传或模型解析。

## 原生后端来源配置

完成原生鉴权方案后，可执行：

```sh
node apps/tools/configure-native-api.mjs --api-base https://your-api-host
```

这只生成 `apps/shared/native-api.config.json` 和精确允许该 origin 的 Tauri CSP override。它不会自动修改网页、登录、启用鉴权或连通服务。Tauri 构建时显式使用 `--config src-tauri/tauri.api.conf.json`；前端仍需读取同一个配置并注入经过服务端验证的 token provider。不要把 CSP 放宽为 `*` 或全部 `https:`。

正式集成还需服务端 CORS 允许实际应用来源、平台网络域名配置、TLS、登录过期处理及用户隔离测试。当前默认配置为空且鉴权未就绪。

## 收货地址流程

先读取账号资料；没有 shippingAddress 时收集并保存地址，再申请报价。服务端返回 ADDRESS_REQUIRED 时不得使用默认华东地区或本地假报价替代。地址变化后服务端会使旧报价无法下单（ADDRESS_CHANGED），需重新测算。收货地址只发送给已配置且完成鉴权的服务端，不写入本机持久缓存或日志。正式服务仍需完成多端认证与个人资料管理验收。
