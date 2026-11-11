# 来源与复用边界

检索日期为 2026 年 11 月 7 日。以下为项目和厂商的一手来源。设备能力是文档证据，不等于本平台已经实机接入；具体型号、固件、选件与授权必须验证。

## 工程与视觉

- [用户指定工程技能 Matt Pocock Skills](https://github.com/aHao030/ai-skills/tree/main/mattpocock-skills)，读取版本 1.3.2；采用需求规格、领域建模、模块设计、任务与验收方法。
- [shadcn/ui](https://github.com/shadcn-ui/ui)，MIT；参考控制台信息结构与可访问交互。
- [Dashboard 示例](https://ui.shadcn.com/blocks/dashboard)，参考侧栏、表格与卡片层级。
- [Vercel Shop](https://github.com/vercel/shop)，MIT；参考购买流程的信息层级。
- [Medusa UI](https://github.com/medusajs/medusa/tree/develop/packages/design-system/ui)，该包 MIT；整个 Medusa 仓库含其他许可材料，不能统一视为 MIT。

## GitHub 制造项目

| 项目 | 已核实范围 | 许可及采用边界 |
| --- | --- | --- |
| [FDM Monster](https://github.com/fdm-monster/fdm-monster) | 多设备管理、适配与队列 | AGPL-3.0；可研究或部署试点，不等于交易平台 |
| [OctoPrint](https://github.com/OctoPrint/OctoPrint) | 文件、作业控制、监测 | AGPL-3.0；候选本地设备端 |
| [Moonraker](https://github.com/Arksine/moonraker) | Klipper Web API | GPL-3.0；平台仍须保证派发去重 |
| [PrusaSlicer](https://github.com/prusa3d/PrusaSlicer) | 无界面 CLI 自动切片 | AGPL-3.0；生产选固定稳定版并校验配置 |
| [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer) | 多品牌切片、校准 | AGPL-3.0；网络插件许可需单独核对 |
| [Spoolman](https://github.com/Donkie/Spoolman) | 料卷库存及耗材统计 | MIT；订单预占与安全余量仍需补充 |
| [Kiln](https://github.com/codeofaxel/Kiln) | 项目自述模型验证、切片、授权打印与外包整合 | AGPL-3.0；候选技术验证，不作为已验证全品牌接入证明 |
| [Khayt](https://github.com/KhaytApp/Khayt) | 报价、工序、质检和经营管理 | FSL-1.1-ALv2；限制竞争用途，仅借鉴流程，不直接复制底座 |
| [Manyfold](https://github.com/manyfold3d/manyfold) | 模型资产管理 | AGPL-3.0；非制造履约系统 |

当前原型未嵌入以上制造项目源码。未来复用时按实际修改、分发和服务方式履行许可；拆成网络接口并不自动免除义务。

## 设备与自动生产

- [Moonraker 文件上传](https://moonraker.readthedocs.io/en/latest/external_api/file_manager/)
- [Moonraker 打印控制](https://moonraker.readthedocs.io/en/latest/external_api/printer/)
- [OctoPrint 文件操作](https://docs.octoprint.org/en/main/api/files.html)
- [OctoPrint 作业控制](https://docs.octoprint.org/en/main/api/job.html)
- [PrusaLink 与 Prusa Connect](https://help.prusa3d.com/article/prusa-connect-and-prusalink-explained_302608)
- [PrusaLink OpenAPI](https://github.com/prusa3d/Prusa-Link-Web/blob/master/spec/openapi.yaml)
- [Bambu 第三方集成说明](https://blog.bambulab.com/updates-and-third-party-integration-with-bambu-connect/)
- [Creality K2 Plus 规格](https://www.creality.com/support/creality-k2-plus-cfs-combo)
- [Formlabs API](https://developer.formlabs.com/api-reference/)
- [Formlabs 队列与操作员启动](https://developer.formlabs.com/core-concepts/queue/)
- [Formlabs 自动报价示例](https://developer.formlabs.com/examples/instant-quote/)
- [EOS 软件与控制许可](https://www.eos.info/enablement/software/software-releases)
- [BLT MES](https://www.xa-blt.com/tech/service04/software-blt-mes/)
- [Farsoon 软件](https://www.farsoon-gl.com/software/)
- [Haas NGC 数据采集](https://haascnc.com/service/troubleshooting-and-how-to/how-to/machine-data-collection---ngc.html.html)
- [DMG MORI Connectivity](https://en.dmgmori.com/products/digitization/connectivity)
- [FANUC FIELD 配置](https://www.fanuc.co.jp/en/product/field/basic/specification/)
- [Siemens OPC UA 配置手册](https://cache.industry.siemens.com/dl/files/031/109974031/att_1295676/v1/ONE_OPCUAOEM_config_man_0724_en-US.pdf)
- [SYIL X7](https://ca.syil.com/x7)
- [Snapmaker Artisan](https://www.snapmaker.com/en/snapmaker-artisan/specs/)
- [Xometry CNC 精密加工](https://www.xometry.com/capabilities/cnc-machining-service/precision-cnc-machining/)

## 支付与物流

- [微信支付平台收付通](https://pay.wechatpay.cn/doc/v3/partner/4012086891)：收货等条件后解冻、分账；须完成平台及商户进件。
- [微信支付接入准备](https://pay.wechatpay.cn/doc/v3/partner/4012086921)
- [分账结果查询](https://pay.wechatpay.cn/doc/v3/partner/4012477734)：受理与最终成功分开判断。
- [分账业务示例](https://pay.wechatpay.cn/doc/v3/partner/4015870957)：默认冻结期限及超期解冻需要监控。
- [快递100订阅推送](https://api.kuaidi100.com/document/5f0ffa8f2977d50a94e1023c)：物流节点变化推送，不等于连续 GPS 定位。

## 跨端与上架

- [Capacitor 环境](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Tauri 分发](https://v2.tauri.app/distribute/)
- [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)
- [Android 应用签名](https://developer.android.com/studio/publish/app-signing)
- [Samsung Galaxy Store FAQ](https://developer.samsung.com/galaxy-store/faq.html)
- [Apple 审核指南](https://developer.apple.com/app-store/review/guidelines/)
- [微信支付小程序接入](https://pay.wechatpay.cn/doc/v3/partner/4012088031)

App Store、Google Play、Galaxy Store 和微信小程序分别审核；响应式网页不能代替原生包、签名、权限及真机验收。
