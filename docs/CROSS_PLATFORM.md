# 跨平台交付与验证记录

跨端工程迭代：v0.8 / API v2 · 文档更新：2026-11-09

## 本轮工程选择

Web 使用仓库根目录 `dist/` 内的 HTML / CSS / JavaScript 作为 Web 演示，不依赖前端编译工具链。手机端提供 Capacitor 8 包装配置，桌面端提供 Tauri 2 源码，微信端提供原生 WXML / WXSS / JavaScript 三页演示。

当前没有使用 React、Taro 或 uni-app。项目已增加统一 API v2 沙盒契约与共享客户端，各端身份接入尚未全部完成：微信默认使用独立本机演示；Capacitor/Tauri 仍是包装源码。托管服务当前使用 Sites 身份，不能推定手机、小程序或桌面端可直接共用浏览器登录。网页与服务端的实现/验证以主项目记录为准；设备、支付和承运商仍是演示边界。

## v0.8 功能覆盖

模型需求、商家能力配置、方案修订和客户确认首先在 Web 与服务端实现。原生包装可准备相同网页资源，但这不表示完成了文件选择、登录或真实设备验证。微信小程序仍保留已有独立页面；不能据此宣称新商家流程已在微信真机交付。

核心规则由同一服务端校验；各端接入时须沿用方案版本、有效期、地址/模型快照和幂等键，不能在客户端自行确认价格或制造权限。真实跨账号商家路由、支付和设备执行仍待接入。

## 目标与实际交付

“覆盖所有主流设备”是产品目标，不是本轮已经完成的兼容性结论。需要按操作系统、版本、CPU 架构、屏幕形态和实际机型逐项建立验证清单；手机、平板、折叠屏和桌面端不能仅由网页可打开推定全面支持。

| 目标 | 本轮文件 | 已做检查 | 尚未完成 |
|---|---|---|---|
| HTML Web | 根目录 `dist/`，由主项目提供 | 具体 Web 验证以主项目交付记录为准 | 浏览器/机型覆盖范围须逐项记录，不由包装源码推定 |
| Windows | `apps/desktop` 的 Tauri 2 源码 | JSON、Cargo TOML 与目录引用检查 | 安装依赖、Rust 编译、exe/msi、签名、安装与 WebView2 测试 |
| macOS | 同一 Tauri 工程 | 配置静态检查 | macOS 编译、Apple Silicon/Intel 测试、app/dmg、签名、公证 |
| Linux | 同一 Tauri 工程 | 配置静态检查 | Rust 编译、目标发行版依赖、AppImage/deb 安装及图形环境测试 |
| Android | `apps/mobile` 的 Capacitor 8 配置 | package/config JSON 解析 | 原生工程生成、Gradle 构建、APK/AAB、签名、真机与商店测试 |
| Samsung Galaxy | 复用 Android 工程 | 目标关系已核实 | One UI、折叠屏/平板、后台通知、Galaxy Store 提审 |
| iOS / iPadOS | 同一 Capacitor 配置 | package/config JSON 解析 | macOS/Xcode 工程生成、归档、签名、TestFlight、真机及审核 |
| 微信小程序 | `apps/weapp` 原生三页源码 | 页面/事件/配置静态检查；本机与远端 adapter 分离；客户端契约测试 | 微信开发者工具运行、真实 AppID、真机、网络域名配置、体验版与审核 |
| 华为原生 HarmonyOS | 本轮未提供鸿蒙工程；列为独立目标 | 已核实官方 ArkTS / ArkUI / DevEco Studio 开发路线 | 鸿蒙工程与平台适配、HAP 编译、签名、真机与上架验证均未完成 |

表内“配置静态检查”不表示构建成功。源码不是安装包；本轮没有可安装的 APK、AAB、IPA、EXE、MSI、DMG 或 AppImage，也没有任何原生商店发布记录。后续实际生成安装包时，应记录构建提交、依赖锁文件、操作系统/SDK、签名身份、版本号和安装验证结果。

## 原生资源隔离

网页编写源仍位于根 `dist/`。托管构建会在该目录生成服务端 `server/` 与托管配置 `.openai/`；这些内容不能进入原生安装包。`apps/tools/prepare-web-assets.mjs` 只复制顶层 html/js/css/svg/webmanifest，并验证浏览器引用到 `apps/shared/web/`。该输出只在 `apps/shared/.gitignore` 中忽略，可从源码重建。Capacitor/Tauri 均指向此隔离目录，dev/build/sync 的 npm 脚本链会先准备并检查。

## 统一客户端与鉴权边界

`apps/shared/api-client.js` 提供 `/api/v2/session`、`workspace`、`quotes`、`orders`、原始模型上传与客户 `accept/dispute/cancel` 的可注入客户端。v0.8 补充服务配置、需求、商家方案和客户确认方法：`getCapabilities`、`getMerchantCapabilities`、`saveCapability`、`getInquiries`、`getMerchantInquiries`、`createInquiry`、`submitProposal`、`acceptProposal`。`transport` 和 `getAccessToken` 由平台提供；所有 POST 均携带 8–128 位 `Idempotency-Key`。微信副本由 `apps/tools/sync-client.mjs` 同步并检查一致性。

这不是已完成的原生登录。托管后端仍使用 Sites 身份，本地后端另外支持浏览器账号 Cookie；这些都不等于原生登录已接通。微信 `AUTH_ADAPTER_READY` 默认 false、`API_BASE` 为空、token provider 返回 null。必须先实现服务端支持的身份交换与授权，才允许启用。不能把 Bearer 头当成 Sites 身份注入，不能复制 ChatGPT Cookie，也不提供所谓原生一键登录。

微信选择服务端模式会先校验 HTTPS 配置与 `getSession()`；未配置/未认证时明确阻止。网络失败保留错误，不退回本机伪报价或假成功。远端订单页只读；本机演示仍可手动推进。Capacitor/Tauri 未接通后端时只展示离线页面壳/已有只读内容，不承诺服务端下单或实时更新。

详细契约与鉴权接入步骤见 `apps/shared/README.md`。

## 目录与运行方式

### 微信原生演示

导入 `apps/weapp` 到微信开发者工具。`project.config.json` 使用 `touristappid`，用于游客模式本地预览；实际预览、登录、体验版或发布需要自己主体的真实 AppID 与相应权限。无需 npm 安装或 Taro 编译。

页面和行为：

1. **定制**：选择内置“桌面连接件”示例，填写材料与数量。
2. **报价**：查看三家虚构示例工坊的价格与交付周期，保存本地演示订单。
3. **订单**：本机模式中，金属 / CNC 先显示工程审核；所有路线手动推进现场检查、生产、打印/加工完成、取件与后处理、质检、物流、收货和结算。未来鉴权启用后，服务端模式只展示服务端订单和事件，不提供本机商家推进按钮。

小程序页面只使用内置模型，不读取真实图纸、不解析任意模型、不请求设备/物流或支付，也不采集姓名、地址等个人资料。本机演示最多保留 20 条订单；未确认成功的 API 请求幂等键会持久保存以供重试，不保存令牌。服务端沙盒选项当前因身份未接入而受阻。游客模式权限以微信开发者工具为准。

### Capacitor 手机工程

在 `apps/mobile` 执行：

```sh
npm install
npm run add:android
npm run sync
npm run open:android
```

iOS 在 macOS 上将 `add:android` / `open:android` 替换为 `add:ios` / `open:ios`。每个平台生成一次原生工程；以后更新 `dist/` 后执行 `npm run sync`。

`webDir` 为 `../shared/web`，相对 `apps/mobile` 目录解析。不使用远程开发服务器作为发布资源。包标识 `com.example.sharedfabrication` 仅为占位。依赖限制在 Capacitor major 8，补丁版本尚未锁定；首次安装后应审核并提交 lockfile。

本仓库统一使用 Node 24+（根服务端使用内置 SQLite）；Capacitor v8 自身最低 Node 要求为 22+。Android 使用 Android Studio 和 Android SDK；iOS 使用 macOS 与 Xcode 26+。不可把官方 GitHub `main` 分支里后续开发版本的要求当成当前选用版本要求。发布前再次核对所选版本及商店 SDK 要求。

### Tauri 桌面工程

安装目标系统的 Rust 和 Tauri 构建依赖后，在 `apps/desktop` 执行：

```sh
npm install
npm run dev
npm run build
```

`npm run dev` / `npm run build` 会先通过 Tauri icon 将 `app-icon.svg` 转成所需图标。当前尚未执行图标生成或原生构建。`frontendDist` 为 `../../shared/web`，因为路径相对 `apps/desktop/src-tauri/tauri.conf.json` 解析。

Windows、macOS、Linux 分别使用对应构建环境；不同 CPU 架构和 Linux 发行版需要明确验证，不能用一个平台的构建成功替代其他目标。

桌面端只声明 `core:default`，没有 shell、文件系统或生产设备插件。当前 CSP 限制为本地资源、内联演示脚本/样式与 Tauri IPC；正式发布前应外置脚本或设置内容哈希，移除 `unsafe-inline`，按统一后端地址最小化授权。

## HTML、PWA 与安装版的区别

- **HTML Web**：通过浏览器访问；响应式布局说明页面能适配宽度，不证明所有浏览器与设备已经测试。
- **PWA**：需要实际配置安装信息、缓存/离线策略及相关浏览器能力。添加主屏幕图标不会生成 APK 或 IPA；本文件不推定 Web 已实现完整 PWA。
- **手机安装版**：还需原生工程、权限、插件、签名、上传/下载与后台行为测试。包内网页和浏览器网页的存储、Cookie、来源、深链可能不同。
- **桌面安装版**：还需平台安装包、系统 WebView 兼容性、签名/公证和更新策略。
- **微信小程序**：不是把 HTML 文件上传就能运行；它有独立页面组件、生命周期、上传与登录接口、服务器域名和审核流程。
- **三星手机**：属于 Android 目标，Galaxy Store 是另一个分发渠道。官方目前支持提交 AAB 并生成通用 APK，但其交付特性与 Google Play 不完全相同。
- **华为原生 HarmonyOS**：按独立平台规划，不能因已提供 Android APK 路线或 Capacitor 配置，就推定兼容原生鸿蒙。华为品牌、不同系统版本与原生鸿蒙目标需分别识别；本轮没有鸿蒙工程、HAP 编译或真机验证。

## 后续工程化与真实业务接入

建议保持一个权威服务端，同时提供客户、商家和运营角色 API。将 DTO、校验、工艺/材料枚举和纯业务函数提取为共享包，再按技术栈选择合适的客户端。正式报价、产能锁定、付款确认、物流验签与结算判断必须在服务端执行。

可评估 React Web + Taro React 小程序 + Capacitor 手机 + Tauri 桌面，也可在团队熟悉 Vue 时评估 uni-app。两者都要为登录、文件、相机、推送、支付回跳、3D 预览及平台权限编写适配。目前已有 `packages/domain` 的纯规则与 `apps/shared` API v2 客户端，微信页面已经统一经过本机/远端 adapter；尚未完成原生身份接入、各端全部 DTO/能力适配及上述框架迁移。服务端权威规则与前端演示规则不能视为已完全统一。

鸿蒙后续建议：使用华为官方 DevEco Studio，以 ArkTS / ArkUI 和 Stage 模型建立独立工程；先接入统一后端与订单核心页面，再适配文件选择、登录、支付回跳、通知和模型预览。共享规则须评估 ArkTS 的语言与运行环境约束后复用，不能直接假设任意 JavaScript 包可用；按所选 SDK 完成 HAP 编译、签名和目标真机验证后再声明支持。本轮没有创建占位鸿蒙工程。官方开发入口见文末第 14 项。

建议逐步补齐的原生能力：

| 能力 | 对产品的作用 | 验证重点 |
|---|---|---|
| 原生文件选择 / 分享导入 | 导入用户自己持有的模型与工程图 | MIME/扩展名校验、大小限制、断点续传、权限、失败恢复 |
| 3D 预览 | 确认方向、尺寸、材料配置 | WebGL/小程序渲染差异、低内存设备、复杂模型退化 |
| 订单与物流通知 | 提醒报价确认、生产异常、到货 | 用户授权、后台限制、平台推送通道、通知跳转 |
| 相机/扫码 | 商家拍摄质检证据、扫描工单 | 权限拒绝、上传重试、证据与订单绑定 |
| 支付与登录回跳 | 在各端安全完成身份和交易闭环 | 深链、状态恢复、后端验签与幂等，不能只信客户端结果 |
| 自动更新 | 发布修复与新版本 | 签名、回滚、渠道差异、商店规则 |

设备网关宜作为独立受管服务部署在商家侧，与统一后端通信。不要把客户 App 包装器当作打印机/CNC 网关，也不要暴露客户可直接使用的设备启动凭证。

## 商店发布边界

Apple 官方审核要求应用具备充分实用功能，超出简单重新包装网站。真实订单管理、文件导入、状态通知等可形成产品功能，但是否通过审核由平台决定。Android、Apple、Galaxy Store 和微信各有开发者身份、签名/主体、隐私材料与审核要求；本工程未申请账户、购买服务或发起发布。

## 本轮验证结果

已完成：平台 JSON/JavaScript/资源路径、窗口权限、微信页面与事件引用、共享客户端副本的一致性检查；客户端契约测试覆盖 HTTPS 地址、未认证拦截、沙盒会话、POST 幂等、网络/服务端错误、不共享浏览器 Cookie、客户端动作白名单，以及微信失败请求在 adapter 重载后复用幂等键。测试使用本地注入 transport，不代表已连通线上身份。

未完成：微信渲染和真机运行；Capacitor/Tauri 依赖安装、原生构建、图标生成、签名、安装测试；鸿蒙工程、HAP 编译和真机验证；所有商店审核。Web 界面另由主项目验证，不在这里推定结果。

## 静态检查、构建与 CI

从仓库根目录执行：

```sh
node apps/tools/prepare-web-assets.mjs
node apps/tools/check-platforms.mjs
node apps/tools/sync-client.mjs --check
node --test apps/tests/*.test.mjs
```

`check-platforms` 也支持 `--target mobile/desktop/weapp`。它不安装依赖、不编译或签名，不把包标识占位符和空 API 配置误报成已可发布。`apps/ci/platform-checks.yml.example` 仅是无凭证检查模板，没有自动启用仓库工作流。

首次受控安装后提交审核过的 npm/Cargo lockfile，再使用 `npm ci` / `cargo --locked`。Android/iOS 生成工程后需保留原生源码和权限/插件配置；当前只忽略构建产物、机器本地文件与证书，不再忽略整个平台目录。

原生 CI 应分别设置 Windows/macOS/Linux Tauri 构建、Android SDK 构建、macOS iOS 模拟器/归档；先验证未签名或调试产物，签名发布另设环境。微信上传需真实 AppID 与授权，不能计入无账户检查的通过项。签名证书和令牌只能通过受控秘密配置提供。

Tauri 的默认 CSP 不允许远程 API。后续完成鉴权后，使用 `node apps/tools/configure-native-api.mjs --api-base https://your-api-host` 生成精确 origin 的 override，再显式作为构建配置加载。该工具不修改网页、不启用登录，不把网络来源配置冒称服务已联通。具体操作见 `apps/shared/README.md` 和两端 README。

## 官方参考资料

1. [Capacitor 环境要求（官网当前 v8）](https://capacitorjs.com/docs/getting-started/environment-setup)
2. [Capacitor Android](https://capacitorjs.com/docs/android)
3. [Capacitor iOS](https://capacitorjs.com/docs/ios)
4. [Tauri 2 环境依赖](https://v2.tauri.app/start/prerequisites/)
5. [Tauri 分发与打包](https://v2.tauri.app/distribute/)
6. [Tauri macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/)
7. [Tauri 应用图标](https://v2.tauri.app/zh-cn/develop/icons/)
8. [Android 应用签名](https://developer.android.com/studio/publish/app-signing)
9. [Samsung Galaxy Store FAQ](https://developer.samsung.com/galaxy-store/faq.html)
10. [Apple App Review Guidelines，4.2 Minimum Functionality](https://developer.apple.com/app-store/review/guidelines/)
11. [微信官方支付开发指引（含小程序服务器域名配置）](https://pay.wechatpay.cn/doc/v3/partner/4012088031)
12. [Taro 官方介绍](https://docs.taro.zone/docs/)
13. [uni-app 官方介绍](https://uniapp.dcloud.io/app/introduction.html)
14. [华为官方：构建第一个 HarmonyOS 应用（ArkTS，Stage 工程、HAP 与签名运行）](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/start-with-ets-stage/)
