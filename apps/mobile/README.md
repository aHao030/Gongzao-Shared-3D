# Android / iOS 包装工程源文件

这是 Capacitor 8 的配置脚手架，不含 APK、AAB、IPA、签名证书或生成的原生工程，尚未安装依赖、执行原生构建或真机验证。网页编写源仍是根目录 `dist/`；原生打包只使用工具生成的 `apps/shared/web/` 浏览器资源目录。

## 构建前检查

从仓库根目录先运行 `node apps/tools/prepare-web-assets.mjs`，再运行 `node apps/tools/check-platforms.mjs --target mobile`。`npm run sync` 也会先检查资源与配置。静态检查不能替代 Gradle/Xcode 构建。

## 本地生成工程

从仓库根目录执行：

```sh
cd apps/mobile
npm install
npm run add:android
npm run sync
npm run open:android
```

在 macOS 上生成 iOS 工程：

```sh
cd apps/mobile
npm install
npm run add:ios
npm run sync
npm run open:ios
```

`add` 每个平台通常仅执行一次。网页资源更新后执行 `npm run sync`。首次安装生成的 lockfile 应由维护者审核后纳入版本管理；当前依赖限制在 major 8，尚未锁定补丁版本。

本仓库统一使用 Node 24+（根服务端使用内置 SQLite）；Capacitor v8 自身最低要求为 Node 22+。Android 使用 Android Studio/SDK，iOS 使用 macOS 与 Xcode 26+。正式构建前以所选版本文档再次核对环境要求。

将 `com.example.sharedfabrication` 改为自己注册的包标识，配置图标、应用名称、权限、隐私声明、原生能力和签名，再按目标商店要求构建。三星 Galaxy 手机复用 Android 工程；Galaxy Store 是独立分发渠道，不是新操作系统。

本配置把生成的 `apps/shared/web/` 作为内容，不配置远程 `server.url`，不把开发服务器当正式发布资源。未来请求统一后端时，应明确 CORS、认证、深链、上传、支付回跳与网络失败恢复规则。不要把任何服务端密钥放进客户端。

当前包装客户端尚未接通后端身份：没有后端连接时仅可展示离线页面壳/已有只读内容，不能承诺登录、创建服务端订单或实时状态可用。它不会自动继承 Sites/ChatGPT 浏览器 Cookie。本机可推进的离线订单演示目前只明确存在于微信演示 adapter；不要把它推定为此包装网页的行为。

共享 API 客户端、精确 HTTPS 来源配置和未来 token provider 见 `../shared/README.md`。配置来源不等于身份已接通。真实支付、生产与物流均未接入。App Store 要求应用提供充分实用功能，不能承诺将网页简单包装即可获批。

- [环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Android 工程](https://capacitorjs.com/docs/android)
- [iOS 工程](https://capacitorjs.com/docs/ios)
- [Android 签名](https://developer.android.com/studio/publish/app-signing)
- [Galaxy Store FAQ](https://developer.samsung.com/galaxy-store/faq.html)

## 原生源码与 CI

已取消对整个 `android/`、`ios/` 的忽略；生成工程后应提交必要的原生源码与权限/插件配置，只排除构建产物、Pods、本机路径与证书。首次依赖安装产生 lockfile 后审核并提交，再将 CI 安装改成 `npm ci`。Android 调试包与 iOS 模拟器构建可以独立验证；发布签名、账号、真机和上架在单独流程完成。参考 `../ci/README.md`，示例工作流没有自动启用。

## 原生资源隔离

`apps/tools/prepare-web-assets.mjs` 只复制根 `dist/` 顶层的 html/js/css/svg/webmanifest，验证 HTML/CSS/manifest 引用均齐全；不会复制 hosted Worker 的 `dist/server/`、`dist/.openai/` 或其他目录。输出 `apps/shared/web/` 是局部忽略的可重建产物。`npm run check` 会自动先准备资源；mobile 的 `sync`/`add:*`、desktop 的 `dev`/`build` 通过前置脚本先准备资源。根 `dist/` 仍是唯一网页编写源。
