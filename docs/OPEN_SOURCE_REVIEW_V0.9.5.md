# v0.9.5 交易沟通与模型估价 · GitHub 源码对照

查阅日期为 2026 年 11 月 11 日。下列链接固定到实际查看的提交。前两项用于设计商家与客户如何围绕一笔需求往来，后两项用于区分模型预算、切片计算和制造报价。

| 项目 | 从源码核对到的做法 | 对共造的取舍 |
| --- | --- | --- |
| Sharetribe Web Template | 交易页按交易 ID 获取和发送消息，活动列表可以展示当事人留言及交易状态变化。根许可证声明 Apache License 2.0。[交易页](https://github.com/sharetribe/web-template/blob/1269a196900d8436ac9b5940d64394f55f3ba920/src/containers/TransactionPage/TransactionPage.duck.js) · [活动列表](https://github.com/sharetribe/web-template/blob/1269a196900d8436ac9b5940d64394f55f3ba920/src/containers/TransactionPage/ActivityFeed/ActivityFeed.js) · [许可证](https://github.com/sharetribe/web-template/blob/1269a196900d8436ac9b5940d64394f55f3ba920/LICENSE) | 让买家和卖家看到正在讨论的模型、数量与询价记录。改价应产生新的报价版本，由客户明确接受。沿用共造现有前端和存储。 |
| Mercur | 会话表保存买家、卖家、末条消息时间与双方未读计数。商家侧路由按已认证卖家限定会话，查询相关订单时再按卖家筛选。根许可证为 MIT。[会话模型](https://github.com/mercurjs/mercur/blob/ae997db052549053b55beb07eb17113625dce52a/packages/registry/src/messaging/modules/messaging/models/conversation.ts) · [商家接口](https://github.com/mercurjs/mercur/blob/ae997db052549053b55beb07eb17113625dce52a/packages/registry/src/messaging/api/vendor/messages/%5Bid%5D/route.ts) · [许可证](https://github.com/mercurjs/mercur/blob/ae997db052549053b55beb07eb17113625dce52a/LICENSE) | 身份和会话参与关系由服务端核对。共造的材质、精度和交期属于具体询价，同一买卖双方讨论两件零件时也需要分别保存上下文。 |
| 3dPrintCostCalculatorSharp | 建模时区分材料、打印时间、工序及利润；文件工时是否再随件数放大可单独配置。根许可证为 Apache-2.0。[计算实现](https://github.com/AndreasReitberger/3dPrintCostCalculatorSharp/blob/fefa4ffb1ccbdb23120faefee0aa6ebe2d1b079d/src/3dPrintCalculatorLibrary.Core/Models/Calculation3d.Methods.cs) · [配置示例](https://github.com/AndreasReitberger/3dPrintCostCalculatorSharp/blob/fefa4ffb1ccbdb23120faefee0aa6ebe2d1b079d/README.md) · [许可证](https://github.com/AndreasReitberger/3dPrintCostCalculatorSharp/blob/fefa4ffb1ccbdb23120faefee0aa6ebe2d1b079d/LICENSE) | 共造继续以整数分和商家费率计价，区分整单、每板和逐件成本。整板切片已含整板数量，不能再把全部机时和耗材乘以件数。 |
| PrusaSlicer | 打印统计结构区分普通与静音模式耗时、各挤出机的材料用量及相关成本，并保留擦拭塔等额外用料。根许可证为 AGPL-3.0。[统计字段](https://github.com/prusa3d/PrusaSlicer/blob/e6c85c50dcc56f9968a61dfdd7a3b695e1004037/src/slic3r-domain/include/Slic3r/Domain/PrintStatistics.hpp) · [许可证](https://github.com/prusa3d/PrusaSlicer/blob/e6c85c50dcc56f9968a61dfdd7a3b695e1004037/LICENSE) | 保留已有的独立运算服务；仅在模型版本、数量、单位、设备和工艺对应时引用切片依据。几何估算应告知客户其假设，特殊工艺仍需工程报价。 |

本次采用这些项目的交互设计与计价思路，功能在共造的代码库内实现。研究没有引入上述前端框架、.NET 运行时或新的切片器二进制。部署现场如启用独立 PrusaSlicer 运算服务，应使用该部署已有的引擎及工艺配置。

## 据此提出的验收问题

1. 同一个客户询问两家商家或两件不同模型时，消息、模型上下文与报价修订能否保持独立？双方之外的账号能否读到内容？
2. 网络中断后重发同一条消息、刷新旧报价页，是否会产生重复留言或意外接受新价格？聊天中的价格文字能否影响订单金额？
3. 客户询问“打 1 件和 20 件各多少钱”时，页面是否说明币种、数量、估价依据及运费是否已计入？商家的私有采购价和利润参数是否仍受权限保护？
4. 模型缺少几何数据、单位未确认、切片与模型不匹配，或工艺超出自动估算范围时，界面是否指出下一步？估算下限不应被当成已确认报价。
