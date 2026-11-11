# Windows / macOS / Linux 桌面包装源码

此目录提供 Tauri 2 的最小工程，复用仓库根目录 `dist/` 的网页演示。它不是已编译、签名或通过安装测试的桌面程序。当前未执行 npm 安装、Cargo 构建或平台打包。

## 本地使用

先按 Tauri 官方要求在目标操作系统安装 Rust 与系统构建依赖，再从仓库根目录执行：

```sh
cd apps/desktop
npm install
npm run dev
npm run build
```

`src-tauri/tauri.conf.json` 内 `frontendDist` 相对该配置目录解析，因此使用 `../../../dist`。本项目无需启动 Web 开发服务器。首次安装产生的 lockfile 应经维护者审核后纳入版本管理；当前 JavaScript 与 Rust 依赖仅固定 major 2。

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
