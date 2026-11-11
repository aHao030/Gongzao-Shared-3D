# 跨端检查与 CI 接入

`platform-checks.yml.example` 是供维护者评审的 GitHub Actions 示例，位于 `apps/ci/`，不会自动运行。它只执行无凭证的源码检查和客户端单元测试，不会安装原生工具链、签名、上传安装包或发布商店版本。

## 在本机运行

从仓库任意目录均可执行静态检查脚本（将脚本路径改为对应位置）：

```sh
node apps/tools/prepare-web-assets.mjs
node apps/tools/check-platforms.mjs
node apps/tools/check-platforms.mjs --target mobile
node apps/tools/check-platforms.mjs --target desktop
node apps/tools/check-platforms.mjs --target weapp
node --test apps/tests/*.test.mjs
```

静态脚本以自身位置解析仓库根目录，不依赖调用目录。`--target` 支持 `all`（默认）、`mobile`、`desktop`、`weapp`；无效参数返回退出码 2，检查失败返回 1，通过返回 0。

检查内容：

- 目标目录的 JSON 解析与 JavaScript 语法；跳过依赖、生成的原生目录和构建输出。
- Capacitor/Tauri Web 资源路径是否准确指向根目录 `dist/`，以及 HTML 直接引用的本地资源是否存在。
- App 标识基本格式、选定依赖主版本与必要脚本。`com.example` 占位、未生成锁文件属于提示，不会误判成原生构建失败。
- Tauri 具名窗口与 capability 目标是否匹配；图标源、生成钩子与输出目录配置是否完整。Rust 文件只检查存在，不将其称为 Rust 编译或完整 TOML 验证。
- 微信页面四件套、页面路由/TabBar、组件声明/路径以及静态事件处理函数引用。此检查不是 WXML 编译器，动态 handler、行为混入、模板作用域和平台渲染仍需微信开发者工具验证。
- 共享客户端与小程序打包副本均存在时进行内容一致性检查，只去掉同步脚本定义的准确生成标记首行。
- `config/service.js` 存在时检查字面量 `API_BASE`：空值允许作为未配置状态；非空必须为无嵌入凭据和片段的 HTTPS URL。它不会连接该地址，也不会证明域名/服务/鉴权可用。桌面未精确授权此 origin 时给出 CSP 配置提示。

`AUTH_ADAPTER_READY=false` 是正常初始状态。服务端模式需实现正式鉴权并配置后才能启用；不要放入长期令牌、AppSecret、支付密钥或借用 ChatGPT Cookie。静态检查通过不表示服务端模式已经联通。

## 启用示例工作流

在实际 GitHub 仓库中评审后，将示例复制到 `.github/workflows/platform-checks.yml`。核对触发分支和路径、Node 版本及 `apps/tests` 测试是否齐全。GitHub 托管 runner 可能按账户和额度计费；本示例没有被复制或启用。

示例使用最小的 `contents: read` 权限，没有 secrets，没有发布步骤，也不执行 `npm install`。项目当前检查代码与客户端测试使用 Node 内置模块。`actions/checkout`、`actions/setup-node` 仍由 GitHub runner 获取；需要更严格的供应链固定时，在启用前将 action 主版本替换为团队审核过的提交 SHA。

## 原生构建后续分层

| 层级 | 建议 runner / 前置 | 应记录的证据 |
|---|---|---|
| 无凭证静态检查 | Linux + Node 22 或更高；本示例使用 Node 22 | 源码提交、检查日志、单元测试结果 |
| Android 调试构建 | Android Studio 对应 SDK/JDK/Gradle；先生成并保留受管原生工程 | 原生依赖版本、debug APK、模拟器/真机结果；不能等同正式签名发布 |
| iOS 模拟器构建 | macOS + 与 Capacitor 版本匹配的 Xcode | 构建配置、模拟器架构和运行结果；IPA/TestFlight 需要后续身份及签名 |
| Tauri Windows/macOS/Linux | 各平台系统依赖、Rust、Tauri CLI；建议独立 runner 矩阵 | 每平台构建产物及安装测试；不能由一个系统的成功推定其他平台通过 |
| 签名与商店发布 | 独立受保护发布流程、开发者账户、签名身份与审核材料 | 签名校验、版本、审核及分发结果；不得把签名私钥提交到仓库 |
| 微信小程序 | 真实 AppID、微信开发者工具或经批准的 CI 上传权限 | 工具编译、真机、体验版与审核记录；游客静态检查不替代这些结果 |
| 原生 HarmonyOS | 独立 DevEco/ArkTS 工程及目标 SDK | HAP、签名、设备测试与上架结果；不由 Android/Capacitor 支持推定 |

原生 CI 接入前，应在受控安装中生成并审核 npm/Cargo 锁文件，再使用 `npm ci` 和相应锁定构建命令。当前缺少锁文件时，不要提供一个必然失败的 `npm ci` 示例，也不要写“构建已通过”。

移动端 `android/`、`ios/` 一旦开始加入原生权限、插件和定制代码，就要纳入版本管理或提供完整可重复生成方案；不能一边忽略目录，一边假设改动会被 CI 保存。构建资源来自 `dist/`，发布流水线应先得到与同一提交对应的 Web 产物，再执行 Capacitor sync/Tauri build。
