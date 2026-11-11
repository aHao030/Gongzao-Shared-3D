# Android / iOS 包装工程源文件

这是 Capacitor 8 的配置脚手架，不含 APK、AAB、IPA、签名证书或生成的原生工程，尚未安装依赖、执行原生构建或真机验证。网页资源来自仓库根目录的 `dist/`。

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

Capacitor 当前 v8 官方要求 Node 22+；Android 使用 Android Studio/SDK，iOS 使用 macOS 与 Xcode 26+。正式构建前以所选版本文档再次核对环境要求。

将 `com.example.sharedfabrication` 改为自己注册的包标识，配置图标、应用名称、权限、隐私声明、原生能力和签名，再按目标商店要求构建。三星 Galaxy 手机复用 Android 工程；Galaxy Store 是独立分发渠道，不是新操作系统。

本配置把本地 `dist/` 作为内容，不配置远程 `server.url`，不把开发服务器当正式发布资源。未来请求统一后端时，应明确 CORS、认证、深链、上传、支付回跳与网络失败恢复规则。不要把任何服务端密钥放进客户端。

当前包装后仍是演示业务，真实支付、生产与物流均未接入。App Store 要求应用提供充分实用功能，不能承诺将网页简单包装即可获批。

- [环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Android 工程](https://capacitorjs.com/docs/android)
- [iOS 工程](https://capacitorjs.com/docs/ios)
- [Android 签名](https://developer.android.com/studio/publish/app-signing)
- [Galaxy Store FAQ](https://developer.samsung.com/galaxy-store/faq.html)
