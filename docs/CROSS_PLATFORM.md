# 跨平台交付与验证记录

版本：0.1 · 资料核验日期：2026-11-07

## 本轮工程选择

首版使用仓库根目录 `dist/` 内的 HTML / CSS / JavaScript 作为 Web 演示，不依赖前端编译工具链。手机端提供 Capacitor 8 包装配置，桌面端提供 Tauri 2 源码，微信端提供原生 WXML / WXSS / JavaScript 三页演示。

当前没有使用 React、Taro 或 uni-app；这些可作为未来产品工程化时的选项。当前各端没有接入统一真实后端，微信端的示例状态也不会与网页同步。设备、报价、物流、资金与结算均不能因包装成 App 就变为真实业务。

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
| 微信小程序 | `apps/weapp` 原生三页源码 | 11 个项目 JSON 与 5 个 JS 的整体检查；三页文件完整性；示例业务冒烟 | 微信开发者工具运行、真实 AppID、真机、网络域名配置、体验版与审核 |
| 华为原生 HarmonyOS | 本轮未提供鸿蒙工程；列为独立目标 | 已核实官方 ArkTS / ArkUI / DevEco Studio 开发路线 | 鸿蒙工程与平台适配、HAP 编译、签名、真机与上架验证均未完成 |

表内“配置静态检查”不表示构建成功。源码不是安装包；本轮没有可安装的 APK、AAB、IPA、EXE、MSI、DMG 或 AppImage，也没有任何原生商店发布记录。后续实际生成安装包时，应记录构建提交、依赖锁文件、操作系统/SDK、签名身份、版本号和安装验证结果。

## 目录与运行方式

### 微信原生演示

导入 `apps/weapp` 到微信开发者工具。`project.config.json` 使用 `touristappid`，用于游客模式本地预览；实际预览、登录、体验版或发布需要自己主体的真实 AppID 与相应权限。无需 npm 安装或 Taro 编译。

页面和行为：

1. **定制**：选择内置“桌面连接件”示例，填写材料与数量。
2. **报价**：查看三家虚构示例工坊的价格与交付周期，保存本地演示订单。
3. **订单**：金属 / CNC 先显示工程审核；所有路线手动推进现场检查、生产、打印/加工完成、取件与后处理、质检、物流、收货和结算阶段。

不读取真实图纸，不提供任意模型解析，不请求设备或物流服务，不调用支付。没有收集姓名、地址等个人资料。演示订单最多存储 20 条，并可在界面清空。游客模式能否启用具体调试功能以微信开发者工具当前权限为准。

### Capacitor 手机工程

在 `apps/mobile` 执行：

```sh
npm install
npm run add:android
npm run sync
npm run open:android
```

iOS 在 macOS 上将 `add:android` / `open:android` 替换为 `add:ios` / `open:ios`。每个平台生成一次原生工程；以后更新 `dist/` 后执行 `npm run sync`。

`webDir` 为 `../../dist`，相对 `apps/mobile` 目录解析。不使用远程开发服务器作为发布资源。包标识 `com.example.sharedfabrication` 仅为占位。依赖限制在 Capacitor major 8，补丁版本尚未锁定；首次安装后应审核并提交 lockfile。

当前官方 v8 环境文档要求 Node 22+；Android 使用 Android Studio 和 Android SDK；iOS 使用 macOS 与 Xcode 26+。不可把官方 GitHub `main` 分支里后续开发版本的要求当成当前选用版本要求。发布前再次核对所选版本及商店 SDK 要求。

### Tauri 桌面工程

安装目标系统的 Rust 和 Tauri 构建依赖后，在 `apps/desktop` 执行：

```sh
npm install
npm run dev
npm run build
```

`npm run dev` / `npm run build` 会先通过 Tauri icon 将 `app-icon.svg` 转成所需图标。当前尚未执行图标生成或原生构建。`frontendDist` 为 `../../../dist`，因为路径相对 `apps/desktop/src-tauri/tauri.conf.json` 解析。

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

可评估 React Web + Taro React 小程序 + Capacitor 手机 + Tauri 桌面，也可在团队熟悉 Vue 时评估 uni-app。两者都要为登录、文件、相机、推送、支付回跳、3D 预览及平台权限编写适配。目前已有 `packages/domain` 的纯规则代码，但尚未接入各端；共享 DTO、API 客户端与平台适配器尚未完成，也未进行上述框架迁移。不能将技术路线目标写成既有代码能力。

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

已完成：全部 11 个 JSON 文件解析、5 个 JavaScript 文件 `node --check`、Cargo TOML 解析、三页页面文件完整性；用内存版 `wx` 存储接口验证非法数量/材料拒绝、报价选择、本地订单持久化、流程不会越过最终状态、清空演示订单。

未完成：微信渲染和真机运行；Capacitor/Tauri 依赖安装、原生构建、图标生成、签名、安装测试；鸿蒙工程、HAP 编译和真机验证；所有商店审核。Web 界面另由主项目验证，不在这里推定结果。

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
