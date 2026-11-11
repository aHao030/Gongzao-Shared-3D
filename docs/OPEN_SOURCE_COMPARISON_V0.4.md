# 共造 · 开源项目对比与采用建议 v0.4

核验日期：2026-11-08。本轮对比以下 7 个项目的公开代码、许可证和官方文档。它们分别覆盖农场管理、设备控制、切片或电商基础能力；**本轮没有找到足以证明开箱完成“上传模型→真实报价→多商户生产→支付→物流→验收后结算”全部流程的项目。** 这不是对所有开源项目的穷尽性结论。

## 七项对比

| 项目与源码 | 可参考或集成的部分 | 与共造目标的主要缺口 | 许可证与采用边界 |
| --- | --- | --- | --- |
| [FDM Monster](https://github.com/fdm-monster/fdm-monster) | 与农场侧最贴近：集中设备管理、队列、文件/G-code 元数据、时间与材料估算、任务历史；公开资料覆盖 OctoPrint、Moonraker、PrusaLink 和 Bambu LAN 路线 | 农场工具不等于客户与商家的交易市场；本轮未核实其具备共造要求的报价交易、支付、物流和验收结算闭环，也不能据此保证每个厂商的所有机型/固件都支持 | `AGPL-3.0-or-later`，以仓库 `package.json` 的声明及实际采用文件为准 |
| [OctoFarm](https://github.com/OctoFarm/OctoFarm) | 对多台 OctoPrint 实例进行集中监控和管理，可参考状态总览、任务历史及设备视图 | 主要围绕 OctoPrint，不能视作所有设备的通用协议层；多商户权限、报价与交易闭环需另建。README 中有关 V2 的描述不作为已上线能力证明 | `AGPL-3.0`；修改、集成与对外提供服务前审查具体分发和运行方式 |
| [OctoPrint](https://github.com/OctoPrint/OctoPrint) | 单设备 Web 管理及 REST API；已有文件上传、选择文件和启动打印的接口，可作为商家网关的一种上游 | 不负责整个市场的报价、订单、支付、商家结算；接口可调用不代表物理现场已具备自动开机条件 | `AGPL-3.0`；集成接口与复制/修改源码分别评估，不忽略插件及第三方组件许可 |
| [Moonraker](https://github.com/Arksine/moonraker) | Klipper 的 API 服务，通过 Unix socket 与 Klippy 通信，可作为网关的状态、文件和任务接口 | 不是覆盖所有品牌的协议，也不自带客户市场和交易能力；需要匹配 Klipper 配置、权限和设备现场条件 | `GPL-3.0-only`，仓库 `pyproject.toml` 明确声明 |
| [CNCjs](https://github.com/cncjs/cncjs) | 面向 Grbl、Grbl-Mega、Marlin、Smoothieware、TinyG、g2core 等控制器的 Web 界面与 G-code 发送，可参考 CNC 状态交互 | 不等于 CAM，不负责装夹、刀具和刀路的完整验证，也不能推导为兼容所有工业数控系统。CNC 自动开机仍需独立认证和现场准备 | `MIT`；保留适用的版权及许可声明，依赖与其他资产另查 |
| [PrusaSlicer](https://github.com/prusa3d/PrusaSlicer) | 模型切片为 G-code；CLI 可用于自动化处理，可作为独立切片任务的候选引擎 | 时间估算依赖与真实设备相符的打印机配置；不会自动补齐工价、排队、后处理、运费和税费，也不是金属制造或 CNC 的通用 CAM | `AGPL-3.0`；引擎修改、服务提供及所分发内容均需许可审查 |
| [Medusa](https://github.com/medusajs/medusa) | 可参考商品、订单、支付与退款等电商工作流及模块化后端设计 | 官方明确 marketplace 不是原生开箱功能，需要自建 vendor 模型、产品/订单关联和拆单；没有自动附带本项目要求的合规延迟放款。不要将其普通用户管理等同于完整多商户权限 | 当前为 open-core：核心 `MIT`，指定 Enterprise 目录适用商业条款；RBAC/SSO 等 Enterprise 能力不能按核心 MIT 一并采用，须逐目录核验 |

许可证栏记录本轮核验到的仓库声明，不替代具体文件、版本、依赖、插件和素材的审查。AGPL/GPL 项目可用于商业场景，但使用者仍须履行适用的许可证条件；不能因为拆成服务或改用 API 就宣称自动免除义务。

## 对本项目的采用建议

### 1. 农场管理以 FDM Monster 为主要对照

参考其“设备总览—任务队列—文件—历史记录”的组织方式，继续保持共造面向客户与商家的简洁入口。农场内部调度和平台交易订单使用独立标识，通过明确映射关联；订单取消、设备失联、重试、清台和质检各自留痕。先确认接入许可、API 能力及指定设备实测结果，再决定采用上游服务或自行实现适配。

### 2. 保留独立商家设备网关

浏览器及云端不直接扫描商家局域网。网关按协议加载适配器，分别声明“可发现、可读取、可上传、可启动、可取消”等能力，权限逐级开放。即使上游项目具备打印控制，也要经过设备、固件、材料、工艺模板、清台与异常恢复验收后，才能进入共造的生产能力清单。不得将文件上传成功视作已经开打。

当前共造已实现的是 **Moonraker 与 OctoPrint 的只读发现和登记路线**，尚未进行真实设备联调。上表中 FDM Monster、OctoPrint 或 CNCjs 的控制能力，不是共造已经完成的适配清单；PrusaLink、Bambu LAN、CNC 控制等仍是后续评估项。

### 3. 为真实报价增加切片任务服务

将 PrusaSlicer 等候选引擎放在有资源和时间限制的独立 worker 中，不在 Web 请求或商家打印机上直接执行不受控切片。每次任务固定并记录模型哈希、单位、切片器版本、设备配置版本、材料及工艺模板版本，保存切片结果、估计材料量、机时和失败原因。

报价再叠加商家工价、损耗、排队、备机、后处理和配送估计，利用实际完成记录校准交付区间。切片估时是输入之一，不能当作保证交期。CNC、金属和不支持的工艺继续走人工审核，不能套用 FDM 的切片结果直接承诺自动生产。

### 4. 电商工作流参考 Medusa，支付另做渠道验证

借鉴订单、支付意图、退款和工作流边界，建立买家、商家及运营的数据归属与授权检查。平台的 vendor 关系和订单隔离必须由本项目完成；若采用 Medusa 的特定权限/SSO 模块，先核对其是否属于商业许可目录。

客户付款、渠道确认收款、客户验收、申请商家结算和银行到账分别记录。收货前限制商家支配款项必须由获批的支付平台产品落实，不能仅靠电商框架的一个状态字段。具体资金路线、渠道期限与验收要求见 [支付与结算设计](PAYMENTS_DESIGN_V0.4.md)。

## 采用前的核验清单

1. 固定候选版本或提交，保存该版本的许可证、版权声明、依赖清单及来源；本文不填未经核实的提交号、星数或维护评级。
2. 优先通过有文档的接口集成并复用合理的业务设计。复制、修改或分发源代码前，逐文件审查许可及相应义务；API 集成本身不是规避许可证的保证。
3. 用同一批受控模型、设备配置和异常场景比较实现，记录估时误差、重复指令、设备失联、重启恢复、权限隔离及资源消耗。
4. 将“上游支持”“本项目已适配”“实机已验收”设为三个不同状态，只有最后一项可以进入正式商家接单能力。

## 补充官方资料

- [FDM Monster 2.0.0 发布说明](https://docs.fdm-monster.net/blog/fdm-monster-release-2-0-0)：队列、文件分析、估算和历史等功能的官方说明；不据此承诺所有品牌型号覆盖。
- [OctoPrint 文件 API](https://docs.octoprint.org/en/main/api/files.html)：文件上传、选择与打印的接口边界。
- [PrusaSlicer FAQ](https://help.prusa3d.com/article/faq-prusaslicer_1789)：时间估计与打印机配置的关系。
- [Medusa Marketplace vendors 示例](https://docs.medusajs.com/resources/recipes/marketplace/examples/vendors)：自建商家模型及关系的要求。
- [Medusa 核心许可证](https://raw.githubusercontent.com/medusajs/medusa/develop/LICENSE)和[Enterprise 许可](https://raw.githubusercontent.com/medusajs/medusa/develop/ENTERPRISE-LICENSE.md)：核心与指定商业目录应分别审查，采用时以固定版本内容为准。

