# Windows / macOS / Linux 桌面包装源码

此目录提供 Tauri 2 的最小工程，复用根目录 `dist/` 的网页编写源，经 allowlist 工具生成浏览器资源到 `apps/shared/web/` 后打包。它不是已编译、签名或通过安装测试的桌面程序。当前未执行 npm 安装、Cargo 构建或平台打包。

## 构建前检查

使用 Node 24+，从仓库根目录先执行 `node apps/tools/prepare-web-assets.mjs`，再执行 `node apps/tools/check-platforms.mjs --target desktop`。图标生成前也自动执行检查；它不安装依赖或编译 Rust。

## 本地使用

先按 Tauri 官方要求在目标操作系统安装 Rust 与系统构建依赖，再从仓库根目录执行：

```sh
cd apps/desktop
npm install
npm run dev
npm run build
```

`src-tauri/tauri.conf.json` 内 `frontendDist` 相对该配置目录解析，因此使用 `../../shared/web`。本项目无需启动 Web 开发服务器。首次安装产生的 lockfile 应经维护者审核后纳入版本管理；当前 JavaScript 与 Rust 依赖仅固定 major 2。

平台准备：

- Windows：C++ Build Tools、WebView2、Rust；正式安装包应按分发渠道配置签名。
- macOS：Apple 构建环境；`.app`/`.dmg` 的对外分发需要处理签名与公证，分别验证 Apple Silicon/Intel 目标。
- Linux：对应发行版的 WebKitGTK、构建工具与其他 Tauri 依赖；按选定发行版验证 AppImage、deb 或其他格式。

本脚手架包含简洁的 SVG 占位图标；`npm run dev` / `npm run build` 会先用 Tauri icon 生成平台图标，但该生成尚未执行。未包含正式品牌设计、安装包签名、自动更新或后台设备连接。配置中的 `com.example.sharedfabrication` 需替换为自己的应用标识。可替换 `app-icon.svg` 后执行 `npm run icons` 重新生成资源。

当前 CSP 仅允许本地资源和 Tauri IPC，禁止远程资源、嵌入对象与表单提交；为兼容 buildless 演示保留了内联脚本和样式。发布前应将脚本/样式外置或使用内容哈希，移除 `unsafe-inline`，并按实际后端来源最小化放行。仅授予 `core:default`；当前不引入文件系统、shell 或生产设备操作插件，也不要直接加载不受信任远程网页并暴露原生权限。

真实平台应在服务端维护报价、订单权限、支付账本和结算条件；此包装不会让网页演示自动变为真实业务。建议设备网关作为独立受管服务，不让客户桌面程序直接控制打印机/CNC。

- [环境依赖](https://v2.tauri.app/start/prerequisites/)
- [分发与打包](https://v2.tauri.app/distribute/)
- [macOS 签名](https://v2.tauri.app/distribute/sign/macos/)

## 后端与离线边界

当前包装尚未接通原生身份。未连接服务端时只应展示离线页面壳/已有只读内容，不能声称登录、创建订单、实时物流或生产操作已可用。Sites/ChatGPT 浏览器 Cookie 不会自动变成 Tauri 登录。共享 API 客户端与 token provider 约定见 `../shared/README.md`。

后端来源准备好后，运行 `node apps/tools/configure-native-api.mjs --api-base https://your-api-host` 生成精确 origin 的 CSP override；在 `apps/desktop` 构建时使用 `npm run build -- --config src-tauri/tauri.api.conf.json`。这只开放必要网络来源，不会启用鉴权或替你接通网页。

首次受控安装后审核并提交 npm/Cargo lockfile，再启用 `npm ci` 和 `cargo --locked`。各操作系统分别构建验证，签名和分发与无凭证检查分开，见 `../ci/README.md`。

## 原生资源隔离

`apps/tools/prepare-web-assets.mjs` 只复制根 `dist/` 顶层的 html/js/css/svg/webmanifest，验证 HTML/CSS/manifest 引用均齐全；不会复制 hosted Worker 的 `dist/server/`、`dist/.openai/` 或其他目录。输出 `apps/shared/web/` 是局部忽略的可重建产物。`npm run check` 会自动先准备资源；mobile 的 `sync`/`add:*`、desktop 的 `dev`/`build` 通过前置脚本先准备资源。根 `dist/` 仍是唯一网页编写源。
