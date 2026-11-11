# v0.9 统一账号与权限边界

这一版补上 Keycloak 可用的 OIDC 接入和可生成的部署配置，保留本机邮箱密码登录。当前仍是每个账号独立的沙盒工作空间；客户视图和已登记商家视图属于同一空间。它还不是允许不同客户向不同真实商家付款的公开交易市场。

## 本次实现

- OIDC issuer 支持 `https://identity.example.com/realms/gongzao`，同时要求发现文档、令牌交换和公钥地址留在配置的身份服务源站。
- `adapter: "keycloak"` 支持 `kc_idp_hint`，仅允许管理员配置的身份提供商别名。`providers.keycloak: "realm"` 打开“统一账号”入口，直接显示 Keycloak 登录页。
- 沿用 Authorization Code + PKCE S256、单次且绑定浏览器的 state、nonce、签名、issuer、audience、azp 和有效期检查。身份键始终是 issuer + sub，不用相同邮箱自动合并账号。
- 每次成功 OIDC 登录更新昵称、外部邮箱及其验证状态。来自身份服务的 `roles` 不会自动授予共造商家或生产权限。
- `services/identity/authorization.mjs` 将已登录账号、商家登记和制造服务权限分开；令牌作用域没有支付、结算或设备启动权限。
- 密钥仅留在服务端。可使用 `clientSecretEnv: "GONGZAO_OIDC_CLIENT_SECRET"` 读取环境变量，不能同时填写 `clientSecret`。

## Windows 本机试运行

需要 Node.js 24 和可用的 Docker Desktop。在项目根目录执行：

```bat
node services\identity\setup.mjs --development
docker compose -f services\identity\compose.yaml up -d
set GONGZAO_AUTH_CONFIG=%CD%\data\identity\auth.config.private.json
npm start
```

PowerShell 的环境变量写法是：

```powershell
$env:GONGZAO_AUTH_CONFIG = Join-Path $PWD 'data/identity/auth.config.private.json'
npm start
```

macOS / Linux：

```sh
node services/identity/setup.mjs --development
docker compose -f services/identity/compose.yaml up -d
GONGZAO_AUTH_CONFIG="$PWD/data/identity/auth.config.private.json" npm start
```

打开共造登录页并选择“统一账号”。本机 Keycloak 在 `http://127.0.0.1:8180`；初始管理员用户名和随机密码保存在 `data/identity/identity.env`，仅供本机管理员读取。这个文件和导入文件含有密钥，不应加入代码包。

生成器输出路径和状态，不会把密钥打印出来，也不会覆盖已经存在的身份目录。平台和 Keycloak 的客户端密钥来自同一次生成，应一起保留。Keycloak 启动导入遇到已存在的 realm 会跳过，修改 JSON 后重启不会自动更新已运行的 realm；后续通过管理控制台调整，切勿删除数据卷来“刷新配置”。

`--development` 明确关闭邮件验证和邮件找回，只允许在本机回环地址使用 HTTP。这样没有 SMTP 也可以试用统一账号；页面不会把这些账号当成经过邮箱验证。该模式不能用于公网部署。

## HTTPS 独立部署

按实际域名生成一次生产配置：

```sh
node services/identity/setup.mjs \
  --public-origin https://print.example.com \
  --issuer https://identity.example.com/realms/gongzao
```

生产模板启用邮箱验证和密码找回。管理员先配置 SMTP 并通过发送测试，再开放用户注册。在 Keycloak 的 Authentication / Required actions 中启用 Configure OTP；如需全员 MFA，设为 Default Action，并按官方流程配置相应认证策略。SMTP 凭据和外部身份渠道的应用密钥由管理员在身份服务中配置，不会由项目生成。

可使用 `services/identity/compose.production.example.yaml` 部署 Keycloak + PostgreSQL。设置 `GONGZAO_IDENTITY_DB_PASSWORD` 与 `GONGZAO_IDENTITY_PUBLIC_ORIGIN`，后者为 `https://identity.example.com`；用受控 HTTPS 反向代理转发到本机 8180 端口，并由代理覆盖外来转发头。该模板没有提供证书、DNS、邮件账户或备份运维。

```sh
docker compose -f services/identity/compose.production.example.yaml up -d
GONGZAO_AUTH_CONFIG="$PWD/data/identity/auth.config.private.json" npm start
```

本机邮箱密码账号和统一账号目前独立存在。切换登录方式不会自动迁移订单；需要保留原账号访问原工作空间。原本机邮箱账号仍不支持邮件验证和找回，这两项只由配置完成后的 Keycloak 统一账号提供。

## 微信、支付宝、X、Apple、QQ、Google

生成的 realm 没有任何第三方身份提供商；项目默认六个渠道仍是“待开通”。对某个渠道完成官方应用申请、身份服务接入、回调地址设置和实际验证后，才在平台配置的 `providers` 中加入对应别名，例如：

```json
{"keycloak":"realm","google":"google-production"}
```

平台会将 `google-production` 作为 `kc_idp_hint` 传给 Keycloak。该别名必须真实存在且启用。微信、支付宝、QQ 等不能仅靠添加这一行获得支持；需要与其协议匹配的身份服务扩展或代理。部署第三方扩展前应审查许可和维护状况。

## 服务端调用合同

```js
const principal = requireMerchantAccess({
  ownerId,                  // 从服务器验证的会话获得
  accountAuthenticated,     // 本机 auth.identity(request) 或可信托管身份
  workspace,                // 按该 ownerId 读取的已保存空间
  mode: 'OWNER_WORKSPACE'
});
```

不能从浏览器请求体读取 ownerId、accountAuthenticated 或 workspace。客户登录但尚未登记商家时，生产库存等接口返回 `MERCHANT_REQUIRED`。修改请求体中的角色、ownerId 或身份服务角色声明都不会获得另一个空间权限。

制造服务在服务器完成独立凭据认证后，可调用 `requireWorkerScope(principal, {ownerId, permission, now})`。接受的 principal 为 `{type:'worker', authenticated:true, workerId, ownerId, expiresAt, revokedAt, permissions}`；权限仅为 `jobs:claim`、`jobs:complete`、`jobs:fail`、`models:read`。此函数是授权检查，不是令牌验证器，不能直接传入浏览器声称的 principal。

## 验证范围

执行：

```sh
node --test tests/identity-v9.test.mjs tests/auth-v7.test.mjs tests/security-v7.test.mjs
```

覆盖 realm 路径、配置的第三方别名、PKCE、不同 realm/audience/nonce 拒绝、跨源发现拒绝、密钥环境变量、默认渠道禁用、商家与 worker 范围、配置生成不覆盖。测试使用本地生成的签名公钥和受控身份服务响应，不代表真实微信/Google/Keycloak 联调完成。当前构建环境无 Docker，未启动实际 Keycloak 容器。

Keycloak 采用 Apache-2.0；本项目通过协议连接，部署时仍应核对固定版本及所添加扩展的许可。

官方来源：

- https://www.keycloak.org/server/importExport
- https://www.keycloak.org/server/containers
- https://www.keycloak.org/docs/latest/server_admin/index.html
