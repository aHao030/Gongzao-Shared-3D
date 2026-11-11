# v0.9 Windows 更新

适用 v0.6、v0.7、v0.8 的同名共造项目；不覆盖数据或私人配置。

1. 在旧启动窗口按 Ctrl+C 停止服务。
2. 将 v0.9 完整解压到旧项目目录之外，例如 D:\Gongzao-v0.9。
3. 在新版目录双击 UPDATE-WINDOWS.cmd。默认更新用户此前指定的 D:\Gongzao-Shared-3D-v0.6-Download\Gongzao-Shared-3D-v0.7。
4. 目标不同可运行 `powershell -NoProfile -ExecutionPolicy Bypass -File tools\update-windows.ps1 -TargetPath "你的旧项目路径"`。
5. 更新成功后从旧目录双击 START-WINDOWS.cmd，浏览器刷新。/health 应显示 0.9.0。

工具先验证 UPDATE-MANIFEST.json 中的路径、大小和 SHA-256，然后备份代码，再覆盖指定代码文件。更新过程中不要同时启动平台。

保留 data、SQLite 数据库、.env、auth.config.json、worker-access.config.json、worker.config.json、integrations.config.json、*.local.json、*.private.json 和设备网关配置。新增示例配置不等于已经配置服务；不会自动启动打印、支付或 Docker。

旁边生成的 `.backup-时间-随机值` 目录保留旧代码和 UPDATE-RECEIPT.json。更新失败按回执核对自动恢复结果；需要手动恢复时先停服务，再按回执恢复被替换文件并移除本次新增代码，保留现有 data。不要将整个备份目录覆盖成数据目录。

无需移动旧账户数据库。生产数据以新增 operations 字段按需创建，旧订单保留原有快照。跨平台更新引擎可以在 Linux 验证文件替换与保留逻辑，但 Windows PowerShell、权限和具体路径仍须在用户电脑运行确认。
