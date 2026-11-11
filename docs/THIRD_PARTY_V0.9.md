# v0.9 第三方项目与接入边界

核查日期：2026-11-09。本仓库新增的是独立适配器、任务合同与部署示例，不包含第三方服务的完整源码、镜像、模型权重或二进制。部署前应保留所使用版本的许可证、归属和源码提供要求，分别检查依赖、插件与商业模块。

| 项目 | 主许可证/边界 | 本版使用方式 |
| --- | --- | --- |
| https://github.com/mikedh/trimesh | MIT | 独立 Python 模型分析依赖 |
| https://github.com/prusa3d/PrusaSlicer | AGPL-3.0 | 本地 CLI 调用，商家白名单配置；发行包不捆绑程序 |
| https://github.com/google/or-tools | Apache-2.0 | 独立 Python 排期建议 |
| https://github.com/Donkie/Spoolman | MIT | 只读库存 API；Compose 选配 |
| https://github.com/taskforcesh/bullmq | MIT 核心；Pro 单独授权 | 独立可选队列适配器；默认主队列不用 Redis |
| https://github.com/Arksine/moonraker | GPL-3.0-only | 服务端协议适配；沙盒不能执行真实启动 |
| https://github.com/OctoPrint/OctoPrint | AGPL-3.0 | 服务端协议适配；沙盒不能执行真实启动 |
| https://github.com/fdm-monster/fdm-monster | AGPL-3.0-or-later | 农场只读查询与配置示例，不复制完整后台 |
| https://github.com/TheSpaghettiDetective/obico-server | AGPL-3.0 | 监控只读适配，识别结果不替代质检 |
| https://github.com/keycloak/keycloak | Apache-2.0 | OIDC 与独立身份部署模板 |
| https://github.com/karrioapi/karrio | LGPL-3.0 核心 + 商业 EE | 运价/物流适配；本版不采用 EE 多租户或 SSO |
| https://github.com/juspay/hyperswitch | Apache-2.0 | 服务器测试支付意向适配，confirm=false，不收款、不分账 |
| https://github.com/FreeCAD/FreeCAD | LGPL-2.1 主许可；组件分别检查 | 仅参考人工 CNC 工程审核流程；不执行 FreeCAD 或刀路 |
| https://github.com/Machine-Shop-Suite/3D-Printing-Quote-Engine | MIT | 参考成本分解思路；本版报价和利润规则为共造自己的实现 |

独立进程/API 调用不作为许可证义务的自动豁免。Docker 镜像、Redis/BullMQ 依赖及原生安装包分发应按实际选用版本另外核对。源码与许可证版本会变化，不能把本表当作未来所有版本的授权保证。
