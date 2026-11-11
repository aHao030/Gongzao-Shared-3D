# v0.9 制造运算服务

本服务把耗时的模型分析、切片和排期放到独立机器执行。网站保持现有 Node / Worker 接口；运算服务主动领取任务，无需向商家局域网开放入站端口。

## 已实现的能力

| 能力 | 当前实现 | 明确边界 |
| --- | --- | --- |
| STL / 3MF 几何检查 | Trimesh 5.2.0，尺寸、体积、面积、闭合性、法向、独立实体数 | 不认证壁厚、结构强度、自相交、支撑或机床碰撞；非闭合体积返回 `null` |
| FDM 切片 | 本地 PrusaSlicer 命令行，生成真实 G-code、解析耗材和预计机时 | 仅采用商家白名单工艺；估计时间需要用实际订单校准 |
| 批量模型 | 数量 1–50，经 PrusaSlicer `--duplicate` 排列 | 当前一次任务一个构建板；超出床尺寸由切片器拒绝或需人工复核，不跨板自动拆分 |
| 生产排期 | OR-Tools 9.14.6206 CP-SAT，已分配设备互斥、工时完整性 | 当前是建议排期；未加入员工班次、换料、节假日、设备维修、运输预测及跨设备择优 |
| CNC 工艺审核包 | `CNC_REVIEW` 仅离线引擎协议，结果附文件校验值和审核项；不在网页队列或 Node worker 领取类型中 | 不生成刀路、不执行 FreeCAD、不自动启动 CNC；需工程师在 FreeCAD CAM 或已验证的商用 CAM 完成工艺 |
| 持久任务 | 服务端任务租约、本地发送日志、同一请求标识重试 | 不调用打印机、支付或退款接口 |

沙盒任务由平台显式生成并标为 `SIMULATED`。这个独立服务只领取 `WORKER` 任务；缺少 Python 依赖、PrusaSlicer 或工艺文件时会报告失败，不会退回模拟数值冒充实测。

## 安装与启动

需 Node.js 24+、Python 3.11+。运算服务可以与本地平台同机，或通过 HTTPS 访问独立部署的平台。

Windows PowerShell，在项目根目录运行：

```powershell
py -3 -m venv .venv-manufacturing
.\.venv-manufacturing\Scripts\python.exe -m pip install -r services/manufacturing-worker/requirements.txt
```

macOS / Linux：

```bash
python3 -m venv .venv-manufacturing
.venv-manufacturing/bin/python -m pip install -r services/manufacturing-worker/requirements.txt
```

先注册并登录本地平台、开通商家工作台。用当前 `/api/v2/session` 返回的 `user.id` 生成仅属于此账号的服务凭据：

```bash
node tools/create-worker-config.mjs --owner <当前账号user.id> --directory . --origin http://127.0.0.1:3000
```

命令生成 `worker-access.config.json`（平台保存的令牌哈希与权限）和 `worker.config.json`（运算服务保存的明文令牌）。不要分享、提交 Git 或放入网页静态目录；已有文件不会被覆盖。生成后重启平台，使其加载凭据。

编辑 `worker.config.json`：

- Windows 的 `pythonExecutable` 填 `.venv-manufacturing/Scripts/python.exe`。
- macOS / Linux 填 `.venv-manufacturing/bin/python`。
- `prusaSlicerExecutable` 填实际 PrusaSlicer 控制台程序完整路径；Windows 一般是安装目录中的 `prusa-slicer-console.exe`。
- `workDirectory` 是任务模型、生成 G-code 和本地日志目录。默认 `data/manufacturing-worker`；限制访问权限，按业务保留策略备份和清理。
- 如为独立部署 HTTPS，修改 `platformOrigin`，不要包含路径。私人托管站点还需要合法的站点服务访问凭据；制造令牌不能代替站点登录。可以通过私有配置 `siteAccessToken` 或 `GONGZAO_SITE_ACCESS_TOKEN` 环境变量提供。

```bash
node services/manufacturing-worker/cli.mjs --config worker.config.json --status
node services/manufacturing-worker/cli.mjs --config worker.config.json --once
node services/manufacturing-worker/cli.mjs --config worker.config.json
```

`--status` 检查真实依赖，不连接平台。常驻运行时保持进程开启；独立部署可使用系统服务管理器或 Docker。凭据默认有效期为 30 天，需由管理员轮换；不要修改浏览器权限来替代服务凭据。

## 商家工艺配置

1. 在 PrusaSlicer 中选择已验证的真实打印机、喷嘴、材料和打印配置，导出完整 INI。
2. 关闭所有 `post_process` 脚本。worker 会拒绝带外部后处理命令的文件。
3. 将文件放到商家控制的私有目录，计算 SHA-256（PowerShell 可用 `Get-FileHash -Algorithm SHA256`；Linux 可用 `sha256sum`）。
4. 在 `worker.config.json` 的 `profiles` 中登记 `localProfileId → path/revision/sha256`，格式见 `services/manufacturing-worker/profiles/README.md`。
5. 在商家工作台保存对应的工艺 ID、版本和文件校验值；修改工艺后递增版本，重新切片。

worker 会同时核对服务端任务版本、白名单版本及实际 INI 校验值。模型始终先转成仅含几何的 STL，再送给切片器；客户 3MF 中附带的配置、G-code 和脚本不参与切片。3MF 声明的单位与客户确认单位不一致时进入人工处理。

PrusaSlicer 输出目前保留在本地任务目录。平台保存结果、文件哈希、耗材和机时证据，不提供未经审核的 G-code 自动下发入口。`printReady` 始终为 `false`。

## 通信与重试合同

所有 POST 使用独立制造服务的 `Authorization: Bearer …` 和 `Idempotency-Key`，平台根据凭据确定账号、worker ID 与允许的任务类别，不相信请求体传入的账号信息。

| 接口 | 请求/结果 |
| --- | --- |
| `POST /api/v2/worker/claim` | `{kinds,leaseSeconds}` → `{job:null}` 或带 `leaseToken/attempt` 的任务 |
| `GET /api/v2/worker/models/:id/download?jobId=…` | 必须携带 `X-Job-Lease`、`X-Job-Attempt`；仅可读取当前租约绑定的模型 |
| `POST /api/v2/worker/complete` | `{jobId,leaseToken,attempt,result}`；结果核对 `inputHash/modelHash/profileRevision` |
| `POST /api/v2/worker/fail` | `{jobId,leaseToken,attempt,errorCode,errorMessage}` |

本地 `worker-journal.json` 在请求前持久保存请求标识。完成响应丢失后，重启会先重发原完成请求，不重复计算。计算中途退出可以重新执行纯运算；设备启动永远不属于此 worker 的任务类型。

租约过期、配置变化或平台拒绝证据时，CLI 停止并保留日志供核对。确认服务端状态后再处理本地日志，不能把旧结果改成新任务的结果。每个工作目录只允许一个 CLI 进程；异常退出遗留 `worker.lock` 时，先确认旧进程已结束再移除锁目录。

## 资源限制与部署

- 模型上限 20 MiB、500,000 个三角面；平台上传入口可能设置更严格限制。
- 3MF 解压总量、成员数量、压缩比、路径与 XML 均预检查；禁止外部资源加载。
- 单工艺文件 1 MiB；G-code 100 MiB；Python 输出 1 MiB；任务超时 30–600 秒。
- POSIX 进程限制虚拟内存和输出文件大小；切片器额外限制 CPU 时间和线程数。Windows 部署建议运行于受控服务账号或隔离容器，并设置存储配额。
- 运算结果只用于报价与工程审核，真实机型验收、清台、材料、质量和付款条件仍独立处理。

`services/manufacturing-worker/Dockerfile` 与 `compose.example.yaml` 提供非 root、只读根文件系统、内存/CPU限制的容器示例。它安装 Python 运算依赖，**不捆绑 PrusaSlicer**。实际切片需在自有派生镜像内安装并锁定已审查的 PrusaSlicer 版本及运行库；挂载私有配置和工艺，配置中的路径相应使用 `/profiles`、`/data`。首次挂载目录需要给容器 UID 1000 写入权限。

本轮实际运行环境为 Node 24 与 Python 3.12 的隔离虚拟环境；Docker 镜像、Windows 原生进程资源限制和 macOS 安装流程尚未实机验证。

Trimesh 为 MIT，OR-Tools 为 Apache-2.0，PrusaSlicer 为 AGPL-3.0。发布或修改第三方组件时应保留许可证并按具体集成/分发方式核对义务；独立进程调用不意味着自动豁免许可证要求。

## 本版验证记录（2026-11-09）

已验证真实 Trimesh 与 OR-Tools 运算；测试环境从 Debian 官方仓库隔离取得 `prusa-slicer 2.9.2+dfsg-1`，实际 CLI 标识为 `PrusaSlicer-2.9.2+UNKNOWN`。这不是对所有机型或较新切片器版本的认证。

| 测试输入 | 结果 |
| --- | --- |
| 仓库 20 mm 立方体 STL | 三轴 20 mm，实体体积 8,000 mm³，面积 2,400 mm²，闭合与法向检查通过 |
| 同模型确认英寸 | 三轴 508 mm；正确应用 25.4 倍尺寸和立方体积换算 |
| 3MF 立方体 | 正常载入；将其毫米单位误选为英寸时拒绝 |
| 3 个 20 mm 立方体真实切片 | 预计机时 3,312 秒，耗材 12.28 g，G-code 493,580 字节；未发送打印机 |
| 实际 HTTP 链路 | 注册随机测试账号 → 商家登记 → 上传 → 领取任务 → Python 分析 → 完成 → 平台重启后证据仍在 |
| 失败与边界 | 模型校验失败、路径越界、后处理脚本、错误配置版本、未知引擎、重定向、完成回报丢失后的幂等重试 |

真实切片测试参数：0.2 mm 层高/首层、15% 填充、1.75 mm 耗材、密度 1.24 g/cm³、0.4 mm 喷嘴、250×210×210 mm 测试构建范围、Marlin 输出，其余为该版本保存的默认设置。这些仅是测试参数，不是商家生产配置。

测试配置 SHA-256：`1968a8422f5bd524c6cb629490d804a2ed5fbc16f5282e3b81854f6ef1e6c53c`。输出文件包含切片器生成信息，不保证跨运行字节完全一致；每次输出单独记录哈希。

可重复验证：设置 `GONGZAO_TEST_PYTHON` 为已安装上述依赖的 Python，设置 `GONGZAO_TEST_PRUSA` 为真实切片器程序，再运行：

```bash
node --test tests/manufacturing-worker-v9.test.mjs tests/worker-platform-v9.test.mjs
```

未设置相应依赖时，真实引擎测试明确标为跳过；默认 Node 测试仍检查配置、通信、校验和持久重试。真实切片不代表打印实物通过，也不代表报价时间已校准。
