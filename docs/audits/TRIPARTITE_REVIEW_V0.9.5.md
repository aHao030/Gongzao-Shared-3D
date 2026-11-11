# 共造 v0.9.5｜消费者、商家与后台业务质询

2026-11-11 · [被审版本](https://github.com/aHao030/Gongzao-Shared-3D/tree/release/v0.9.5) · 48 个角色问题，13 个定制场景

## 先解决哪几件事

1. **把需求带到店铺。** 首页写下的颜色、公差、用途和期望收货日应进入选店后的需求草稿，供客户确认分享。特殊要求需逐条标明是否已计价。当前在示例 PLA 支架上提交普通留言与“红蓝双色、哑光喷漆、加急”，一件参考预算同为 ¥21.96–22.86。
2. **把确认的条款带到订单。** 建立绑定模型、需求版本、店铺、价格、运费和交期的待支付订单。旧版确认协商报价后，两端订单仍为空；模拟订单已有的状态控制可复用。
3. **让报价和现场条件一致。** 在商家侧显示成本、毛利、变更理由及可承诺产能。自设最低整单利润为 ¥30 的测试店铺可以报出含运 ¥0.01 并被确认。目前该动作只写会话。
4. **把异常带到专人工作队列。** 独立记录延期、少件、错色、争议与退款。当前后台最多看最近创建的 32 个工作区，返回部分统计提示；真实复测中，较旧的争议未计入该汇总。

## 清单之外的需求怎么接

客户在上传后、联系商家时均可点「添加要求」。可逐条选颜色、尺寸、表面、安装、包装、交付或「其他」。每条保留适用部位与数量、文字/图片/技术图纸、必须或可协商、可否替代及判断合格的办法。复杂规则按需展开，单色普通件沿用短流程。

商家可设置自己能提供的服务模板、适用材料设备、是否需要审图、默认计价单位、包含项与最低开工费。收到清单外要求可直接在这张询价中新建一次性项目，回复「已包含」「另行报价」「需补资料」「可替代」或「无法承接」。重复出现的项目可保存为本店模板。平台不应仅凭聊天关键词自动收费。

报价单列每单一次的设计/调色/治具费、每板准备费、逐件工序/配件、实际机时和运费。按批共享的成本不再按件重复。客户应看到与上版相比的增减费用、新交期及样品验收依据；客户明确接受后，报价与需求一并冻结。范围不清时，可保留基础制造预算并显示待报价项与预计回复时间。

## 10 件标牌的估价示例

多色试算为整批10件管理用示例，同一材料 ¥80/kg。机时 ¥6/h 已含电，人工 ¥36/h，包装 ¥3/批，不另设风险准备。目标估算毛利 25%，最低整单利润 ¥8，最低机时利润 ¥1.50/h；服务费按 v0.9.5 模型 7% 向上取整到分。单色仅为外形成本基准。运费和税费另计。

| 工艺 | 成品 / 非成品耗材 | 整批机时 / 人工 | 整批成本 | 制造价 | 平台费 | 整单 / 平均单件 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 单色外形基准 | 100 / 5 g | 3 h / 12 min | ¥36.60 | ¥48.80 | ¥3.42 | ¥52.22 / ¥5.22 |
| 同层四色 | 100 / 65 g | 5.5 h / 24 min | ¥63.60 | ¥84.80 | ¥5.94 | ¥90.74 / ¥9.07 |
| 可拆四色拼装 | 100 / 12 g | 3.6 h / 35 min | ¥57.06 | ¥76.08 | ¥5.33 | ¥81.41 / ¥8.14 |

拼装方案另含整单 ¥2.50 胶材。整批成本按耗材、包含电力的机时、人工、包装及额外工序计算。制造价取「成本 ÷ (1 − 目标毛利率)」「成本 + 最低整单利润」「成本 + 机时 × 最低机时利润」三者最高值，上调到分。平台服务费按制造价的 7% 上调到分。商家可另配合理损耗准备，实际毛利取决于真实消耗。本例没有另加损耗风险准备；使用切片总量时，已包含的清洗耗材与换色机时不能再加一遍。

## 追加、修改、售后的分界

| 阶段 | 工作人员和商家如何处理 | 客户如何付费或取回差款 |
| --- | --- | --- |
| 未付款 | 发布新版，原报价失效，展示差异和交期 | 自主接受新总价或放弃 |
| 已付款未开工 | 暂停受影响工单放行，发变更单；可选择保留原约定 | 先确认净差额，补款或退款均关联原付款 |
| 已开工 | 由现场人员核实已完工件、能继续用的材料和剩余工序；对受影响部分重新安排 | 买方主动变更按事先同意且可举证的增减成本计价，旧工序不可重复收取 |
| 已发货或收到货 | 从原单开售后，按件定位错色、缺件或误差，支持返修、补寄和部分退款 | 商家偏离确认规格，按约承担补救；原图与文字冲突未澄清，不自动归责扣费 |

## 13 个场景

### 同一零件，不同件数分色

20 个手柄，10 黑、10 白，每件单色。

- 接单时确认：按件选颜色和件数，核对丝料、批号及能否分批交货。
- 计价：分色排批；各批启动/换卷及实际排板计一次。两批共寄一箱时按一箱包装计。
- 验收：黑 10、白 10；若缺白料，给替代色样或新交期，买家确认后才替换。

### 凸字按高度换色

黑底、白色凸起文字，不需要黑底区域在字的高度继续变色。

- 接单时确认：上传标注图，确认换色层、文字厚度、同材兼容；检查图案能否一次切层实现。
- 计价：一次换料可按实际增加的机时、废料及值守收费；若值班时间赶不上，改交期。
- 验收：以批准的预览或首件确认字色、朝向和层高；图案落在同层时重新选工艺。

### 同一层反复切换四色

10 个同款四色徽章，同一层有多块颜色。

- 接单时确认：为区域绑定色号与料槽；检查喷嘴、材料兼容、库存、色间污染与设备可用性。
- 计价：按该排版整板切片得克数、清洗量和时长；共用耗材只计一次，若分两板分别核价。
- 验收：客户确认四色图、颜色顺序与色差依据；交付 10 个，审计可追溯切片版本。

### 拆件拼色，或者打印后喷漆

相同四色外观，可接受拼缝吗？也可能要求无拼缝和哑光。

- 接单时确认：勾选能否拆件、胶接、可视接缝、光泽；黑白图之外另收参考样或批准色样。
- 计价：给可行的分别报价。拼色按拆件设计/装配，喷漆按遮蔽、底漆、喷涂、固化和质检。
- 验收：选定一个方案。拼色验缝和连接牢度，喷漆验颜色、光泽及遮蔽边界。

### 颜色相同，材料不同

主体要硬，脚垫要软；客户写“都做黑色”。

- 接单时确认：分别指定材料及性能。检查能否同机、同温区结合，或需单独打印后装配。
- 计价：不能承诺兼容时转工程审核。分别核材料、支撑和装配，给可行替代及交期。
- 验收：按客户同意的硬度/装配试验验收，采购缺料时不擅自换料。

### 同一套装多张图纸

外壳 1、支架 2、螺钉嵌件 4，需要组装后寄出。

- 接单时确认：按明细行绑定零件版本、单套数量、材料、装配方式和交付套数。
- 计价：零件随数量计，嵌件按颗，设计/治具按次，组装按套，运费按包裹。
- 验收：订单和装箱单显示套数与散件数。只改支架时，保留其他零件原价和版本。

### 带标注的工程件

外观差不多即可，但两个定位孔要和手头的轴配合。

- 接单时确认：让客户标关键尺寸、公差、装配对象、检测方法；图纸与模型冲突时先澄清。
- 计价：普通外观区用基础价；精加工、嵌件和额外检测按实际工时/件数；需打样则单列。
- 验收：交付时给关键孔的实测或检验记录，双方能按同一图纸版本判断合格。

### 只有草图，需要代建模

发来手绘图，想先看 3D 效果再做实物。

- 接单时确认：先确认尺寸、修改轮数、交付文件、使用范围、初稿和确认日期。
- 计价：设计费独立列项，可约定按项目/小时、含几轮和超出费率；打印预算待模型确认再定。
- 验收：先验收设计文件，再决定是否打印。报价能看出设计和制造各占多少钱。

### 先打样，再放量

首件合格后追加到 200 件，尚未确定第二批。

- 接单时确认：明确样件确认标准、阶梯数量是否承诺、同色批次、余量和交期。
- 计价：首件/治具按一次，量产按阶梯与每板；写明样品费抵扣条件，客户能比较不同数量。
- 验收：放行样件版本后才排量产；同版复购不重复收已付设计费，改版另行报价。

### 活动有硬截止时间

周五开幕，要周四到货，可以加钱加急。

- 接单时确认：分别确认工程审核、排队、加工、后处理、发货、运输和收件地时区。
- 计价：只给能预留的产能报加急费；快递加价独列。分清承诺发货、预计送达与无法保证的节点。
- 验收：商家能拒绝不可能兑现的日期；延误能看到责任节点及改期/取消等约定。

### 每件名字不同

婚礼桌牌 30 个，每件一个名字，有 2 个特殊字符。

- 接单时确认：导入或逐行填写名字，预览文字朝向、字体、序号与每行数量，明确拼写确认人。
- 计价：模板排版按次，个性化逐行、刻字或换工序按件；出错后只修受影响行。
- 验收：客户一次签样并可点开任意一件；商家排版错误产生的补打可追到对应编号。

### 已付款后追加要求

下单后要换颜色、增加两件、改收件地，或要求改图。

- 接单时确认：标明原因、付款/开工/发货阶段，核实已做几件、材料是否已不可逆消耗。
- 计价：变更单列正/负差额、证据和新交期；买方改需求按已同意成本处理，卖家做错不作加价项。
- 验收：客户拒绝变更时原条款仍可查。涉及返工的部分须明确处置，授权前不收新费用。

### 交付后局部不合格

20 件中 2 件孔径不合格，18 件可用；客户只需两件补打。

- 接单时确认：用批次、件号、量测照片，对比冻结图纸与首件。记录缺陷、责任与期限。
- 计价：针对 2 件选择补打、返修或部分退款；列补寄运费和对商家应付的影响。
- 验收：售后单追溯到原件、原订单和对应金额，重复处理不重复扣款或补寄。

## 48 项质询与验收

- 审查基线为 2026-11-11 的 v0.9.5，GitHub 版本提交 2c64ca9d4ebbf596030c17ff3b8a15ea12195507，已核对代码树与受审源码一致。
- 在隔离环境重跑完整套件共 554 项，546 项通过、0 项失败、8 项因可选制造引擎未就绪而跳过。专项场景使用合成账号、临时数据库或接口替身，不能替代真实资金、硬件或承运商验收。
- P0 为开放真实有偿试点或对应高风险操作前应解决；P1 为明显交易损耗或特定服务开放前应解决；P2 为可在受控试点排期改进。条目为角色质询，同一笔交易可能涉及多种岗位。
- 已复现表示在源码对应的正常流程或注明的故障模拟中得到结果。源码确认表示核查了接口、存储或界面实现。待实测需要真实用户、供应商或部署演练。没有用访谈、量产样本衡量痛点发生频率。
- 当前私有站点访问名单为一人、零外部访客。已有独立账号询价、店铺隔离、文件共享撤销、报价版本与经营看板；跨商户支付、生产、物流和结算要分别取得机构或设备的端到端证据。

### 消费者

#### C-01 · P0 · 确认店铺报价后，哪一笔订单承接这份协议？

已复现。独立买卖账号确认最新报价后，会话变为已接受，双方工作空间的订单和设备状态均不变；下单与冻结款仍在另一套演示订单流中。

买家以为已预订，卖家没有可履约订单；另开订单容易抄错价格、版本或归属店铺。

- 建议：从已接受报价发起同店结账，校验卖家、金额、模型版本、数量、到期状态，明确显示付款结果与订单号。
- 验收：两店对同一模型分别报价；仅甲店的选定报价可生成甲店订单。双击/刷新仅一单，乙店不可见。
- 依据：[tests/trade-review-v095.test.mjs:154](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/tests/trade-review-v095.test.mjs#L154) · [dist/trade-ui.js:360](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade-ui.js#L360)

#### C-02 · P0 · 付款前能看到最终到手价、币种及另付项目吗？

已复现。预算返回 CNY，运费和税费为空、特殊后处理另计；会话报价只记录整单价、运费是否包含和文字条款。海外地址能按国家校验，例行海外报价进入人工审核，支付方式为规划。

两家看似同价的方案可能一个含运一个另收。跨境买家无法据此知道要付多少、谁承担税费。

- 建议：结账预览按项列制造、包装、服务费、后处理、运输和税费，标明币种、承担方及有效期；未知项目转人工补齐。
- 验收：相同模型寄境内、英国，含运/不含运分别核对；正式应付金额与确认单和支付凭证一致，未知费用禁止直接扣款。
- 依据：[services/platform/budget-estimate.mjs:68](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/budget-estimate.mjs#L68) · [services/platform/trade-store.mjs:85](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L85)

#### C-03 · P0 · 为什么看到“几天发货”，却不知道哪天到，也追不到真实包裹？

源码确认。真实店铺会话只有预计发货天数；旧订单发货只认 DEMO- 运单，送达由模拟动作推进。已有物流适配器可单独读取费率和轨迹，不能证明该买家的订单已绑定真实包裹。

客户无法判断能否赶上装配日期，延期、退回或少件时也难判断应找谁。

- 建议：区分备料、排队、制造/质检、发货与送达区间；包裹绑定订单，展示承运商、最后更新时间及异常入口。
- 验收：分别用国内/跨境测试运单验证按时、延期、退回，乱序重复轨迹只通知一次；物流签收与客户验收保持独立。
- 依据：[services/platform/trade-store.mjs:233](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L233) · [services/platform/core.mjs:275](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/core.mjs#L275) · [services/integrations/index.mjs:63](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/integrations/index.mjs#L63)

#### C-04 · P0 · 20 件里坏了 2 件，验收后发现孔径不对，还能申请补做或部分退款吗？

源码确认。旧订单退款请求金额固定为整单；开争议要求款项处于模拟冻结及限定结算状态。已支持冻结期间暂停发货与结算，已结算路径不支持该申诉。

客户只能全退或放弃，验收后发现的隐蔽缺陷没有订单内处理入口。

- 建议：建立按件数/批次的售后单，能提交照片和测量证据、约定返工或部分退款；结算后仍可受理并单独核算。
- 验收：20 件中 2 件超差时，双方能核对验收标准、只补做 2 件或退相应金额；结算完成后仍有可追踪的申诉和处理结论。
- 依据：[services/platform/core.mjs:324](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/core.mjs#L324) · [services/platform/core.mjs:353](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/core.mjs#L353) · [dist/app.js:532](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/app.js#L532)

#### C-05 · P1 · 同样叫“打印工作室”的两家店，凭什么选一家？

源码确认。公开店铺目录返回 id、name、mine，店铺下拉仅展示名称。单店预估可用，缺少并排展示工艺、公差能力、发货地区、交期和经过核验的履约记录。

赶工、金属件和精度敏感买家只能逐店重复询问，难以判断质量和可信度。

- 建议：提供按模型和规格筛选的店铺卡，显示服务范围、核验状态、能实现的公差、预算及预计发货，对未积累数据的商家诚实留空。
- 验收：用同一零件比较只做 FDM 和具备 CNC 能力的店；未验证能力不得标为已验证，同名店能按编号及资料区分。
- 依据：[services/platform/trade-store.mjs:106](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L106) · [dist/trade-ui.js:302](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade-ui.js#L302)

#### C-06 · P1 · 最终制造的是哪个版本，关键孔、颜色和公差如何验收？

源码确认。独立会话绑定一份模型、数量、单位等；报价结构保存金额、天数、运费选项和最长 500 字条款。会话动作无替换模型或关联新修订的操作；独立演示需求流程已有公差等字段。

买家能追溯报价版本，却很难证明商家承诺哪一项尺寸公差，模型改版还需重新发询盘。

- 建议：把版本化工程规格同步至真实会话，列明关键尺寸、公差、材料/颜色、表面处理和验收法；换图显示修订差异，旧报价需重确认。
- 验收：V1→V2 改孔时保留两份模型与规格；V1 报价无法确认 V2，不同买家可独立核对验收证据。
- 依据：[services/platform/trade-store.mjs:156](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L156) · [services/platform/trade-store.mjs:233](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L233) · [services/platform/trade-http.mjs:57](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-http.mjs#L57)

#### C-07 · P1 · 为什么 20 MB 以内的文件也会失败，STEP 或金属件多久能得到预算？

已复现。上传框突出单文件 20 MB。实测 2,500,134 字节、50,001 面的二进制 STL 返回 413 MODEL_TOO_COMPLEX；8 MiB 加 1 字节的 ASCII STL 返回 413 ASCII_STL_TOO_LARGE。STEP、CNC 的预算进入人工审核，无金额。

复杂的可用模型会在上传后才被拒绝；工程审核如果没有责任人和回复时间，买家不知道应该简化还是等待。

- 建议：在选择文件前展示格式、大小及三角数限制；为大文件提供受限上传/替代提交。工程审核回执给出需补资料、受理人和首次答复时间。
- 验收：50,001 面但小于 20 MB 的 STL 给出针对性处理路径；STEP 和金属件能看到审核进度、补件及答复期限。
- 依据：[dist/app.js:427](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/app.js#L427) · [services/platform/geometry.mjs:36](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/geometry.mjs#L36) · [services/platform/budget-estimate.mjs:78](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/budget-estimate.mjs#L78)

#### C-08 · P1 · 买 51 件，能把原数量交给这家店核价吗？

已复现。同一示例模型 50 件整单预算 ¥675.85–759.82；51 件返回 HTTP 语义 400 / INVALID_QUANTITY。开真实询盘对数量也只接受 1–50。

客户被迫分成多单或把虚假数量填为 50，整板成本与批量优惠不能正确分摊。

- 建议：将询盘可表达的数量与自动排版容量分开；大货走批量人工报价，支持首件确认、分批交期和阶梯价。
- 验收：51 件、200 件均能保留原始数量进入询盘；未验证可生产前不自动承诺价格。
- 依据：[services/platform/budget-estimate.mjs:60](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/budget-estimate.mjs#L60) · [services/platform/trade-store.mjs:159](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L159) · [dist/trade-ui.js:309](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade-ui.js#L309)

#### C-09 · P1 · 上传错图、商业机密图，哪里查看授权并清理原件？

源码确认。每个店铺会话可单独撤回授权，已下载副本无法收回；工作空间达到 100 个模型即拒绝新模型。当前客户模型路由支持上传和下载，未见逐件删除、保留期、跨会话授权总览的客户入口。

长期客户无法自助清理闲置模型；同一模型问过多家后，要逐会话查找仍然有效的授权。

- 建议：增加模型库与授权总览、归档/删除、关联订单保留原因及期限；可按店铺集中撤销，清楚提示对方已下载的副本。
- 验收：一个模型发给两家店后可一处查授权、撤掉甲店并保留乙店；未关联订单的误传图可清除，保留中的文件显示原因。
- 依据：[services/platform/core.mjs:170](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/core.mjs#L170) · [services/platform/http.mjs:99](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/http.mjs#L99) · [dist/trade-ui.js:355](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade-ui.js#L355)

#### C-10 · P1 · 本地邮箱用户忘了密码，靠什么取回图纸、消息和订单？

已复现。本地密码重置及邮箱验证接口回归返回 503；渠道配置可区分 OIDC 与本地密码账号。托管平台身份、外部身份服务自带的恢复方式应分别验收。

换机或忘记密码后，已有项目和沟通记录可能长时间无法继续使用。

- 建议：为独立邮箱账号提供一次性找回、过期提示和旧会话失效，配置地区可用的登录渠道；提供受核验的客服恢复流程。
- 验收：用测试邮箱完成首次验证、过期链接、忘记密码、换机登录和重试，仅能恢复原账号；默认安装也正确告知可用方式。
- 依据：[services/platform/auth-local.mjs:213](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/auth-local.mjs#L213) · [services/platform/auth-config.mjs:20](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/auth-config.mjs#L20) · [tests/auth-v7.test.mjs:107](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/tests/auth-v7.test.mjs#L107)

#### C-11 · P1 · 关闭页面后，怎么知道商家回了报价，或付款前报价即将到期？

源码确认。消息中心每 8 秒轮询，页面隐藏时跳过刷新；报价自发出起 7 天有效。通用队列含 notification 类型，当前真实会话流程未见持久事件自动发送订阅提醒。

客户必须主动回访；急单和新版报价可能错过，商家会反复催促。

- 建议：支持用户同意的站外提醒及站内待办，针对首次回复、新报价、即将到期和物流异常提供去重与免打扰。
- 验收：关闭页面后，订阅用户收到一次指向对应会话的提醒；同一事件重试不重复，关闭订阅的用户不收到。
- 依据：[dist/trade-ui.js:221](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade-ui.js#L221) · [dist/trade-ui.js:244](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade-ui.js#L244) · [services/platform/trade-store.mjs:233](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L233)

#### C-12 · P1 · 海外客户看到的报价到期时间和订单时间是哪个时区？

已复现。聊天时间采用浏览器默认时区，订单通用时间固定 Asia/Shanghai。复算同一时刻在 11 月 11 日洛杉矶为 04:00、上海为 20:00，当前相关短日期渲染均未标时区。地址已做国家适配，关键页面主要使用中文。

跨时区用户可能误判截止时间；部分双语地址字段不足以让海外客户独立完成确认。

- 建议：按客户语言与时区统一显示报价、订单及通知时间，跨区承诺显示时区；优先覆盖金额、条款、错误和争议。
- 验收：美国时区在聊天、订单、通知看到同一到期瞬间，各显示时区；切英文后可读完报价和售后关键路径。
- 依据：[dist/trade-ui.js:9](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade-ui.js#L9) · [dist/trade-ui.js:64](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade-ui.js#L64) · [dist/app.js:69](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/app.js#L69) · [dist/trade.html:2](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade.html#L2)

#### C-13 · P1 · 微信里收到自己的图纸，为什么小程序只能选示例？

已复现。小程序上传页通过 selectSample 标记示例；其“先看模型预算”在已配置服务端和鉴权时可用，但正常入口仍是示例模型。网页端真实上传是另一条路径。

在微信咨询的客户必须转网页重新上传，容易中断或上传到不同工作空间。

- 建议：支持合规的文件选择和真实模型上传；受限机型提供绑定同一账号、同一模型和询盘的网页续办入口。
- 验收：同一测试账户在微信提交实际 STL，再在网页打开能看到同一模型和会话；权限受限时可续办且不丢参数。
- 依据：[apps/weapp/pages/upload/index.js:16](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/apps/weapp/pages/upload/index.js#L16) · [apps/weapp/pages/upload/index.wxml:11](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/apps/weapp/pages/upload/index.wxml#L11) · [apps/weapp/pages/quotes/index.wxml:5](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/apps/weapp/pages/quotes/index.wxml#L5)

#### C-14 · P1 · 客户在首页填的颜色、用途和目标到货日，选真实店铺后商家还能看到吗？

已复现。演示需求保存颜色（80字）、备注、公差和期望收货日期。跨店咨询只接受模型、数量、材料、单位、精度、正文等；实际提交结构化 color 被拒绝。

客户把“红色、用于户外、周五收货”填在一处，切换到真实咨询后需重新输入。未重述的约束不会进入商家看到的询盘。

- 建议：给真实询价和报价共用一份版本化需求，分开保存材料、颜色标准/客户色样及交付偏好。由客户选择是否共享备注及参考图。
- 验收：填好颜色、用途和日期后联系一家真实测试店铺，无需重填。客户、商家和报价快照显示同一版需求；修改后留旧版对照。 联系两家店时分别确认需要分享的信息。
- 依据：[dist/workflow-ui.js:95](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/workflow-ui.js#L95) · [services/platform/inquiries.mjs:64](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/inquiries.mjs#L64) · [services/platform/trade-store.mjs:157](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L157)

#### C-15 · P1 · 同一笔询价能否同时附模型、色卡、丝印定位图或带公差的 PDF？

已复现。首页每次读取第一个上传文件。真实会话只固定一个模型和对应原件，普通消息只接受 body。合成测试附第二个定位图字段返回 400；PNG 可作为单独模型上传，PDF 不在上传格式范围。

关键外观或尺寸依据容易散落在其他会话或站外记录里。完工验收无法确定商家据以生产的是哪份附图。

- 建议：在一条询价中支持有角色标记的附件组，如主模型、尺寸图、丝印定位、颜色样稿；逐件展示版本和下载授权，冻结接单时的文件组合。
- 验收：同一订单完整关联一个模型、定位图和公差 PDF；商家看到同一版本组合，未授权第三方不可见，更换附图后需双方确认。
- 依据：[dist/app.js:427](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/app.js#L427) · [services/platform/geometry.mjs:27](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/geometry.mjs#L27) · [services/platform/trade-store.mjs:157](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L157) · [services/platform/trade-store.mjs:296](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L296)

#### C-16 · P1 · 哑光喷漆、遮蔽螺纹或加急能否得到独立的价格与到货承诺？

已复现。预算明确排除特殊后处理。相同样件、1件 PLA，普通留言与“红蓝双色、哑光喷漆、加急”的留言均冻结 ¥21.96–22.86；isRush 字段被拒绝。商家可在条款填写后处理、总价和预计发货天数。

客户容易把预算当成含外观要求和加急交货的金额。商家也很难证明报价究竟包含哪道工序、多久完成，以及哪些尺寸必须遮蔽。

- 建议：将耗材本色、多色打印、喷漆/丝印分别建模；登记适用材料、目标面/遮蔽区、色卡、光泽、人工及固化时长等。分开显示常规预算、工序钱、加急钱、预计发货和到货；未确认时显示待核价。
- 验收：同一零件分别选原色、指定区域哑光喷漆和加急，列出价差、依据、交期及范围；商家无法承诺目标日期时必须提示。
- 依据：[services/platform/budget-estimate.mjs:72](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/budget-estimate.mjs#L72) · [services/platform/trade-store.mjs:85](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L85) · [services/platform/trade-store.mjs:157](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L157) · [dist/trade-ui.js:348](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade-ui.js#L348)

#### C-17 · P1 · 模型和样品都没有，只有一张草图，怎么知道设计费与打印费各是多少？

源码确认。真实店铺咨询围绕单个已上传模型或示例建立，商家报价只有一个总额。现有接口未单独记录设计交付物、修改轮数和设计验收。

容易把建模工时包含在一口价里，交了初稿仍不清楚能否继续改、是否必须打印。

- 建议：提供设计服务需求，明确交付格式、含几次修改、文件使用范围、报价和时间；建模确认后再报制造。
- 验收：发布草图、接受两轮修改，验收模型后可决定是否继续打印；已付设计费用在后续订单可追溯。
- 依据：[services/platform/trade-store.mjs:157](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L157) · [services/platform/trade-store.mjs:85](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L85)

#### C-18 · P1 · 套装有外壳、支架和嵌件，各有不同数量，如何知道一套交齐了？

源码确认。每个真实询盘固定一个模型 ID 与一个数量，文件授权限定该图。独立店铺报价未定义按零件汇总、装配及分包交货的明细行。

多个会话之间容易错件、漏件、重复包装和运费，也无法只换有问题的零件。

- 建议：支持多零件需求单，记录每套件数、零件版本、单项工艺和分批交付，按真实包裹计运费。
- 验收：下单2套，每套1个外壳、2个支架、4颗嵌件；改一个支架版本时其他行价格不变，装箱合计2、4、8。
- 依据：[services/platform/trade-store.mjs:157](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L157) · [services/platform/trade-store.mjs:180](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L180)

### 商家

#### M-01 · P0 · 只填店铺名称就能接到询价，客户如何判断我具备真实制造能力？

已复现。合成账号只填店名即可登记，返回 sandbox_unverified；开启咨询后，该店随即出现在另一账号的店铺目录。接询价已有账号绑定，但未验证营业主体、工艺样件、收款主体。

客人难以比较商家能力；平台无法按风险决定哪些店可以接哪些付费订单。

- 建议：区分咨询资格和付费接单资格。付费准入记录店铺主体、能力证明、服务地区及结算通道状态，支持审核与复核。
- 验收：资料未审可试用询价，不能接付费单；通过 FDM 验收的店仍不可承接未核准的金属工艺；撤销后禁止新交易。
- 依据：[services/platform/merchant.mjs:149](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/merchant.mjs#L149) · [services/platform/trade-store.mjs:117](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L117)

#### M-02 · P0 · 客户付款后，现在是否可以无人值守生产？

已复现。生产台账模式为 SIMULATED；现有生产测试完成后命令计数为 0；有条件的外部控制适配与平台签发已核实工单是两个环节。备机核对、切片版本和阻止重复派送已实现。

把注册设备、模拟付款或切片成功当成实机发单会导致备机状态和承诺失真。

- 建议：按设备和工艺逐项验收，从只读监控到人工放行的单机试点；仅在付款核实、匹配的工艺版本及现场联锁满足时签发生产工单。
- 验收：付费单到同一台已验收设备的可追溯工单一一对应；断联、配置变更、危险状态或重复回执均进入相应阻断/核对流程；CNC 单独验证。
- 依据：[services/platform/operations.mjs:303](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L303) · [services/platform/operations.mjs:309](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L309) · [docs/INTEGRATIONS_V0.9.md:82](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/docs/INTEGRATIONS_V0.9.md#L82)

#### M-03 · P0 · 商家能上传真实运单、拆包发货或更换错误运单吗？

源码确认。订单发货要求 DEMO- 开头的演示单号，且物流状态须为 NONE；订单只写一个 tracking 值。另有可选 Karrio 查询接口，其轨迹结果不会触发结算。

不能将普通快递单号直接作为真实履约凭证；分批生产、多箱、改号、退件时无法逐包追踪。

- 建议：区分包裹、运单、承运商轨迹及数量；支持承运商识别、订阅/回补和经审计的改号，验收与结算使用实际交付范围。
- 验收：一次订单分两包，一件签收、另一件滞留时仍显示部分交付；换号保留旧轨迹；重复/乱序轨迹不重复触发后续动作。
- 依据：[services/platform/core.mjs:276](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/core.mjs#L276) · [services/integrations/index.mjs:43](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/integrations/index.mjs#L43)

#### M-04 · P0 · 新订单的应收、到账和售后扣款能不能逐笔对上？

源码确认。平台保留商家应收与服务费快照，但结算成功写 SIMULATED_SETTLED，所有者操作模拟结果；支付通道仅测试模式。没有真实提供商回款、银行入账和经营对账的验证。

财务无法把一笔订单与净入账、手续费、退款和提现失败逐项核销；模拟成功无法作为收款依据。

- 建议：选择试点地区和可提供平台分账的渠道，接入商户子账户、签名事件、退款和结算账单；提供差异和待处理视图。
- 验收：一笔订单的收款、平台费用、商家净额及部分退款与渠道对账单对应；外部回执重放不重复记账；对账差异不能显示到账。
- 依据：[services/platform/pricing.mjs:117](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/pricing.mjs#L117) · [services/platform/core.mjs:320](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/core.mjs#L320) · [services/integrations/catalog.mjs:7](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/integrations/catalog.mjs#L7)

#### M-05 · P1 · 客服、工程师、生产和财务轮班，谁接手哪个询价？

源码确认。店铺与会话的商家身份绑定单个 merchant_id，开店账号角色固定为 merchant_owner；收件箱在页面可见时轮询，关闭页面会停止轮询。

多人要么共享店主登录，要么需另行转述；看不到待工程核价、待客户回复和即将超时的责任人。

- 建议：把店铺与个人账号分离，加入成员、岗位、负责人和交接记录；给接单通知提供可配置渠道与静默时段。
- 验收：客服只能沟通、工程师能核价、财务只能看结算；移除成员后立即失权；店主离线时值班员仍能收到待办，重复提醒合并。
- 依据：[services/platform/trade-store.mjs:100](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L100) · [dist/trade-ui.js:244](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade-ui.js#L244)

#### M-06 · P1 · 店铺设了最低利润，客服少输两个零还能对外发价吗？

已复现。将最低整单利润设为 ¥30，三件 PLA 店铺预算下限为 ¥58.61；聊天中仍可发送含运的 ¥0.01 总价并获确认。旧方案流程会校验成本和利润底线，聊天界面仅在部分条件下提示。此例没有产生订单或损失。

一旦用于真实承诺，商家可能把整单误当单价、忘算运费或低于成本接单；客户误以为谈妥的金额可直接支付。

- 建议：对外报价拆出制造、包装、运费和服务费，在商家侧显示预计净收入和毛利；允许店主对例外报价给出理由，记录批准人。
- 验收：相同成本输入在两种报价入口给出相同经营明细；低于自设底线按店铺政策处理；仍允许授权折价；客户看不到采购成本。
- 依据：[services/platform/trade-store.mjs:85](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L85) · [services/platform/inquiries.mjs:172](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/inquiries.mjs#L172) · [dist/trade-ui.js:346](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/dist/trade-ui.js#L346)

#### M-07 · P1 · 我的 400 mm 大机明明能做，为何 300 mm 的零件还要人工核价？一百件能一次询价吗？

已复现。400 mm 工艺配置配 300×20×20 mm 闭合样件时，店铺预算返回 GEOMETRY_REVIEW，布局方法返回空；咨询和自动预算限 1–50 件。几何预算是矩形包围盒估排，固定 250 mm 参考板且按单独成板。

大机和专业批量农场展现不了产能，销售需手工解释和拆单；也不能把几何估板当作真实拼板收益。

- 建议：按已验证机床工作域及边距估板，较大数量转批量询价，支持分批交付；复杂摆放、支撑和混单使用切片证据后再计入成本。
- 验收：同一 300 mm 模型在 240 mm 和 400 mm 两个配置应给不同结果；100件保留一个询价号和多板计划；复制件数不重复放大机时。
- 依据：[services/platform/budget-estimate.mjs:82](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/budget-estimate.mjs#L82) · [services/platform/pricing.mjs:71](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/pricing.mjs#L71) · [services/platform/trade-store.mjs:156](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L156)

#### M-08 · P1 · 我有没有可兑现的发货日，两个客服是否把同一台机器的同一时段卖了两次？

源码确认。聊天报价的发货天数由商家填入；排程读取已有生产任务，结果标为 confirmed:false，耗材预留在建立生产台账时校验，当前只对演示料卷生效。结果未知的生产任务不在排程快照内，实际派工又会阻止其占用设备被复用。

机器忙、材料不足、节假日或上单待核对时，仍可向不同客户承诺同一交期。

- 建议：分开显示预计与已承诺交期；付费承诺前核对设备、材料、班次和未知任务，给可回收的短时产能预留。
- 验收：同一产线两个并发请求不能同时确认最后一个时段；未知或维修设备不能贡献可承诺产能；过期释放并向客户更新交期。
- 依据：[services/platform/trade-store.mjs:90](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L90) · [services/platform/operations.mjs:105](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L105) · [services/platform/operations.mjs:277](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L277) · [services/platform/operations.mjs:314](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L314)

#### M-09 · P1 · 一批拓竹、其他联网打印机和 CNC 接入后，哪些能识别到具体机型？

源码确认。本机发现路径探测 Moonraker /server/info 或 OctoPrint /api/version。前者可有控制器状态，后者识别的是服务；一次最多 32 个目标。FDM Monster 是只读列表，拓竹兼容性待现场验证。现场型号/固件覆盖未实测。

相同协议不能证明所有机型可运行，也不能向经营多品牌农场承诺一键纳管或可打印。

- 建议：按机型、固件、网络模式公开发现/型号核验/状态/授权能力矩阵；大农场分组、分页，提供手工录入、冲突与诊断。
- 验收：分别验证两个相同型号实体、一台拒绝授权的设备及超过 32 台的模拟目录；报告明确显示发现数量、未核验机型及原因。
- 依据：[services/device-gateway/discovery.mjs:26](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/device-gateway/discovery.mjs#L26) · [services/device-gateway/discovery.mjs:53](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/device-gateway/discovery.mjs#L53) · [services/integrations/catalog.mjs:4](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/integrations/catalog.mjs#L4)

#### M-10 · P1 · 客户给了我模型，怎样在同一条询价下完成工程复核和切片？

源码确认。原件有按会话授权、下载及撤回；商家的切片排队只在本方工作空间按模型 ID 查找，聊天页提供下载，未见从会话发起带权限的工程任务。文件 ID 同时取决于内容和文件名。

另存、改名、重新上传后，难以说明用哪一份模型核价，旧样件或重复文件容易被当成定稿。

- 建议：将工程任务绑定到会话、授权范围、模型版本和哈希。加入图纸/容差、客户确认和设计修改记录，同时保留撤回对未来访问的效力。
- 验收：同名不同内容不能混用；从原询价发起工程审核后能追溯同一份输入；只授权摘要不能运行需原件的处理；换版需重新核价。
- 依据：[services/platform/operations.mjs:117](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L117) · [services/platform/geometry.mjs:30](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/geometry.mjs#L30) · [services/platform/trade-store.mjs:275](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L275)

#### M-11 · P1 · 一板二十件有两件不合格，如何只补打这两件？

已复现。质检记录是整单通过/失败和备注。正常演练扣用 30 g 后登记失败，状态为 QC_FAILED；基于同一订单重建生产任务返回 ORDER_ALREADY_PRODUCED。退款申请金额固定为整单金额。

完工后不能在原单上记录合格件、废件、局部补打或部分赔付；真实利润也难反映返工材料和工时。

- 建议：加入批次/件数检验、照片与测量、返工子任务、部分退款及退料归属；把重打实耗汇总到原订单。
- 验收：20 件中 18 件合格、2 件补打时只新增 2 件生产，二次费用入原单；若改为部分退款，账款总额守恒且证据可追溯。
- 依据：[services/platform/operations.mjs:262](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L262) · [services/platform/operations.mjs:336](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L336) · [services/platform/core.mjs:330](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/core.mjs#L330)

#### M-12 · P1 · 经营一段时间后，还能继续接单和处理存量订单吗？

源码确认。新建生产台账限制历史总数低于 100；店铺已有 1,500 个咨询即不能接新会话，按全部会话计数；生产操作幂等记录也有 1,500 条总量上限。源码未见对应商家归档入口。

即使历史任务已完结也可能在正常运营中达到硬上限；直接删历史会损害售后追溯或重试保护。

- 建议：分开活动负载和历史账本；历史可检索归档，幂等键按业务保留期处理；在软限额前提示容量。
- 验收：准备已完成的 100 个台账和 1,500 个已结束咨询，再开新单仍能处理；历史记录可查，已执行的重试不会被当作新动作。
- 依据：[services/platform/operations.mjs:281](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L281) · [services/platform/trade-store.mjs:185](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L185) · [services/platform/operations.mjs:408](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L408)

#### M-13 · P1 · 同一种 PLA 的红、蓝两卷，或带多个料槽的机器，能否按实际颜色交付？

源码确认。Spoolman 接口能读 color_hex。同步到平台库存仅保留材料、名称、重量等，人工登记可把颜色写在名称里。演练生产只绑定一卷并匹配材料，切片统计会把多路用量加总。

识别出设备品牌或登记了相同材质，仍不能证明指定料色、槽位、余料和换料组合可用。换色损耗也难按卷核算。

- 建议：由店铺公布可交付配色及工艺；生产侧记录耗材卷、色号/批次、占用槽位、设备观测时间、逐卷用量与换料损耗。允许人工换色或人工核价。
- 验收：双色样件的两卷分别预留和核销。第二卷短缺、颜色不符、状态过期时转人工；没有验证多色能力的机型不能自动接受该组合。
- 依据：[services/integrations/index.mjs:58](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/integrations/index.mjs#L58) · [services/platform/operations.mjs:254](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L254) · [services/platform/operations.mjs:278](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L278) · [services/manufacturing-worker/engine.py:177](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/manufacturing-worker/engine.py#L177)

#### M-14 · P1 · 客户上传已经局部分色的模型，红色外壳和白色字母的空间位置会保留吗？

源码确认。原始 3MF 可以保存并独立授权下载；工作器做几何检查后会导出仅含几何的 STL 再切片，客户 3MF 中的附加配置不会进入生产。未见可审签的逐零件/逐面配色清单。

原件保留并不代表多色生产文件保留颜色区域。把整件当普通单色件估工与派单，会产生外观不符及重打成本。

- 建议：把分色图、区域到颜色的映射及确认版预览作为制造规格。只导入可信的几何和颜色映射；无法可靠还原时转人工核查，由客户确认色稿后再接单。
- 验收：对双色 3MF 或分件模型，用黑白也可区分的区域编号显示两个色区；若区域映射丢失则阻止按已确认多色件投产。
- 依据：[services/manufacturing-worker/engine.py:232](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/manufacturing-worker/engine.py#L232) · [docs/MANUFACTURING_WORKER_V0.9.md:68](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/docs/MANUFACTURING_WORKER_V0.9.md#L68) · [services/platform/trade-store.mjs:180](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-store.mjs#L180)

#### M-15 · P1 · 预算与实耗到底差多少，哪些店铺、工艺需要调参数？

待实测。估价能标记几何或切片依据，生产记录已留估计与实耗。已查工作流未提供真实跨店订单按工艺比较预估/实耗/返工成本的校准报表，缺少量产记录检验准确度。

几何估算区间容易被理解成保证；小件、支撑多和频繁换色的订单可能持续偏价。

- 建议：按机型、材料、工艺与批量记录估算偏差、实际毛利、准时率，样本不足时给人工报价。
- 验收：实际试产同时保存预估和真实耗材、机时与次品；可回看偏差而不改写旧报价，超出店铺阈值时提示复核。
- 依据：[services/platform/budget-estimate.mjs:31](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/budget-estimate.mjs#L31) · [services/platform/operations.mjs:284](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L284)

#### M-16 · P2 · 功率和电价换算后成本相同，为何整单金额相差几分？

已复现。将 5.5 小时、250 W × ¥0.80/kWh 与 200 W × ¥1.00/kWh 两组等价输入对照，切片估价的电费相差 ¥0.01，合成整单报价相差 ¥0.03。

对账和导出的精确金额可能不一致，尤其是整数分向上取整时。

- 建议：用整数瓦时与固定精度费率计算，确定每个费用项目的取整顺序。
- 验收：两组等价输入所得整单制造成本与服务费逐分一致；仍能重现旧版已确认的价格快照。
- 依据：[services/platform/operations.mjs:219](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/operations.mjs#L219)

### 后台工作人员

#### O-01 · P0 · 后台显示零笔争议，能据此让当班人员下班吗？

已复现。在 SQLite 最早的工作区创建一笔已打开的争议，再写入 32 个空工作区。业务摘要从 1 变为 0，响应同时明确 partial=true、scanned=32。取样顺序是工作区创建顺序。

老店今日的新投诉也可能不在值班清单里；人员只能看到覆盖不足提示，没有继续翻页查漏的入口。

- 建议：建立按业务事件更新的全站异常索引，摘要由该索引产生。保留个人资料隔离，只向有权限人员显示对应任务。
- 验收：建 33 个工作区，在最早工作区新增退款和争议；总量和待办各显示一笔并可打开，重放事件不重复。
- 依据：[services/platform/admin-business.mjs:12](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/admin-business.mjs#L12)

#### O-02 · P0 · 客服接到“孔径不合格”投诉后，下一班同事能接手续办吗？

已复现。本地合成订单提交争议及唯一原因，订单成功记为 OPEN，但订单中找不到该原因。网页按钮仅传 open。后台可读取争议数量，管理动作中没有认领、补证或裁决。

双方已经表达过的要求需重述，现有冻结保护能挡住结算，却没有负责人推动解冻或救济。

- 建议：新增独立售后案件，关联订单、商家、报价版本及相关证据。双方按案提交照片/测量记录，客服按权限查看，设置时限并支持交接、申诉。
- 验收：客户发起尺寸争议后能看到案号和下一步；客服 A 交接给 B 后，理由、原图版本、测量证据、期限和最后裁决均可追溯。
- 依据：[services/platform/core.mjs:353](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/core.mjs#L353)

#### O-03 · P0 · 财务怎样证明客户付了多少钱、平台应收几元、商家实到账多少？

源码确认。Hyperswitch 接口只生成/查询测试意向，未确认真实扣款；业务摘要特意不取金额，现有模拟结算能区分平台和商家应收，但没有逐笔渠道对账处置入口。

将模拟成功或客户签收当作银行到账，会造成错付；遇到拒付、超时、差额、重复通知时没有可交接的财务清单。

- 建议：为获准市场的支付服务商建立支付、退款、结算、出款分离的账本；以渠道通知和账单核对，差异进入财务队列，由不同岗位复核。
- 验收：在服务商测试商户回放重复/乱序回调、结算失败、退款、拒付和银行出款失败；订单、渠道账单及商家应收可按币种逐笔勾稽，差额有责任人。
- 依据：[services/integrations/index.mjs:70](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/integrations/index.mjs#L70)

#### O-04 · P0 · 一家店铺资质过期或连续接单不发货，运营能只暂停这家吗？

源码确认。店主完成商家资料后可自己开启公开咨询；后台管理动作只有人员、节点和全站订单受理开关，不能让店铺资质进入待审、限制新咨询或记录申诉结果。

只能依赖店主自行关闭或扩大影响面，订单、买家联系及证据保全难以协调。

- 建议：增加入驻审核、按店铺/工艺限权、到期复核和申诉；暂停新业务同时保留老单沟通、发货及售后。
- 验收：停用 A 店某工艺后，它无法接对应新咨询/新单，另一店可正常承接；A 店待发订单和原客服入口继续可用，结论可申诉。
- 依据：[services/platform/admin-control.mjs:15](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/admin-control.mjs#L15)

#### O-05 · P0 · 夜班客服、财务、系统运维能否各自仅拿到本职权限？

源码确认。现有 owner、operator、auditor 能分离授权、运维及只读；operator 的节点和全站受理权限绑定。本地邮箱登录没有内置 MFA，部署方可通过外部身份提供方配置。没有客服、财务权限或高风险复核动作。

上线前直接给新岗位套用旧角色，会导致人员无法办案或权限过大；单个账号容易完成不应独办的高影响操作。

- 建议：拆分案件、财务、审核和运维权限；为生产后台接入强认证，对批量退款、变更收款、批量停业等按风险设双人复核与有时限的应急授权。
- 验收：客服可认领案件但不能轮换节点或改收款；制单人无法批准自己发起的高风险动作；离职撤权后已有会话也不能写。
- 依据：[services/platform/admin-control.mjs:66](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/admin-control.mjs#L66)

#### O-06 · P0 · 数据库恢复以后，怎样确认文件、账号撤权和已支付订单处在同一时间点？

待实测。SQLite 已提供快照校验和新目录恢复；运维手册要求恢复后重新核对授权和节点凭据，将托管 D1/R2 恢复交给部署环境。此次没有执行云端整站恢复。

只恢复一个数据库可能使新图纸丢失、使旧授权恢复，或让渠道流水与平台订单状态不一致。恢复时间和可承受丢失量尚无现场证据。

- 建议：制定业务可接受的数据恢复点和恢复时间；协调 D1、R2、身份、密钥及渠道账本进行隔离演练，核对撤权后再开放外部访问。
- 验收：任取一次备份后发生过退款和撤权的时间点恢复，抽样核对模型哈希、账本差额和撤权结果，记录实际恢复时长与丢失区间。
- 依据：[docs/ADMIN_OPERATIONS_V0.9.4.md:62](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/docs/ADMIN_OPERATIONS_V0.9.4.md#L62)

#### O-07 · P0 · 买家确认后要改颜色或加急，后台能只补差价、同时保住原合同和生产队列吗？

已复现。实测本地模拟订单 222 元，进入待工程审核后修改方案报 INQUIRY_ALREADY_ORDERED。已接受的独立聊天报价也锁定，只能另开咨询。当前没有把新报价、原订单、净差额、退款/补款、剩余数量及新工单连起来的变更单。

重新开单容易产生两笔付款、两次派单或重复计算已经收过的每单准备费；直接改写旧价又会使客服和财务无法复盘。

- 建议：保留原单，创建带版本的变更单。未付款以新版代替旧版；已付未开工暂缓该单派工，核对库存及产能；已开工记录完工/在制/待做数量和可复用材料，仅调整获同意的余量；已发货按售后或新单承接。 争议或冲突未解决时，冻结受影响工序的新增扣款与结算。
- 验收：用四阶段分别提交同一项换色；未付只留一个可付报价、未开工只生成一次净差额、已开工不重派已完成件、已发货不改写原物流。重复确认或回调不重复补款、退款或派工。
- 依据：[services/platform/inquiries.mjs:157](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/inquiries.mjs#L157)

#### O-08 · P0 · 实物是白色而客户要黑色，如何区分买家改意、商家错做、原图与文字冲突，决定谁承担费用？

源码确认。保存的模型哈希、方案版本、需求快照可作依据；已检索的下单和验收分支没有将图文冲突、责任归属、纠正工单与差价授权绑定的对象。

用同一个改价按钮处理三种原因，会把商家纠错费算给客户，或让商家承担未同意的新增工艺成本。

- 建议：在生产前固定同一组图纸、部位标注、条款与样色。有冲突先暂停放行并书面澄清；买家主动变更按约核算列明的净增减价及新交期，商家偏离已确认规格则按约免费补救；证据不足由客服按案件复核后再决定分担。
- 验收：同一双色订单分别演练主动加色、商家反色、文件/文字互相矛盾。主动加色需签新版，原应白而做黑的返工不再向买家收费；图文冲突只能进入澄清，责任未定期间不得自动派工或扣差额。
- 依据：[services/platform/inquiries.mjs:209](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/inquiries.mjs#L209)

#### O-09 · P1 · 20 个定制件只有 2 个不合格，客服可以只处理其中两件吗？

源码确认。退款只接受整单金额，部分金额会报 PARTIAL_REFUND_UNSUPPORTED。质检、生产实耗和退款记录虽已存在，后台没有按件补打/折让处置动作。

只有全退或拒绝，损失可能全部转嫁给买家或商家，也无法说明补打材料、运费和结算差额由谁承担。

- 建议：按订单项、批次和数量受理补打、补寄、部分退款或部分放款，附上责任、运费和双方确认，给财务出具差额记录。
- 验收：20 件中 2 件不合格，同时提交两次相同申请；只补偿 2 件一次，18 件应收可核对，退补寄物流互相关联。
- 依据：[services/platform/core.mjs:324](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/core.mjs#L324)

#### O-10 · P1 · 发生较久的争议或误操作，能回溯当时哪位人员作了什么决定吗？

已复现。在隔离库连续操作 201 次后，后台保留 200 条，auditDropped=1，第一条已移出。首管主机另有交接日志；现有后台近期审计确实有操作者和修订号。

活动频繁时调查窗口按条数缩短。后台记录不能单独作为长期售后复盘和财务稽核依据。

- 建议：按经批准的保留策略把关键操作写入独立、受控的追加式归档；关联案号、订单、理由与审批，支持按事件范围导出并校验完整性。
- 验收：第 201 次操作后仍可在归档核对第 1 次的操作者、动作、理由、版本、时间；查阅和导出本身也记录。
- 依据：[services/platform/admin-control.mjs:188](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/admin-control.mjs#L188)

#### O-11 · P1 · 客户撤销授权或要求删除旧模型，数据管理员如何核对所有副本？

已复现。会话撤权会再次检查版本并阻断未来下载。云存储适配器先写 R2 再提交 D1；隔离故障桩模拟 D1 提交失败后，仍留下 1 个没有工作区提交记录的对象。现有适配器提供存取，没有全量孤儿清理/导出删除工作流。

撤销一家店下载与平台清理原件是不同动作。遗漏原件会增加敏感图纸留存和存储成本；已交付店铺的副本不能由平台远程回收。

- 建议：增加上传暂存、提交标记、延迟垃圾回收和数据请求工单；删除前逐一核对在制订单、争议保全、授权和备份到期。
- 验收：失败上传经过规定窗口后被回收；有效订单和争议证据仍可用；客户可取得处理回执，列出平台可清除和已交付的范围。
- 依据：[services/platform/store-d1.mjs:21](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/store-d1.mjs#L21)

#### O-12 · P1 · 健康页为绿色但制造、物流或结算已经积压，值班人员何时会收到通知？

源码确认。/ready 对工作区和会话表做有限读取，也检查对象存储读通道；节点在 90 秒窗口内收到心跳即显示在线。接口不检查切片成功率、订单承诺日、物流事件延迟或支付差异，现有运维手册将外部告警列为另行部署。

代理在线或表可读时，实际服务仍可能延误。缺少按影响订单数和商家定位的值班告警。

- 建议：把接口就绪、制造任务积压、过期未发货、物流停滞及资金待对账分别监控。设置责任人、消重和升级值班规则。
- 验收：保持心跳正常但延迟合成切片或物流事件；健康探针与业务告警分别显示正确状态，告警附受影响订单、处理手册并可确认恢复。
- 依据：[services/platform/readiness.mjs:12](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/readiness.mjs#L12)

#### O-13 · P1 · 权利人举报模型侵权，或商家反映定制内容不适合承接，谁能及时处置？

源码确认。当前询价仅向参与双方开放；管理动作没有按案举报、受理投诉、限制传播及申诉的流程。撤回原件只能由买家控制。

依赖私聊会使举报无法流转，也容易为了核实少数件而给后台人员开放所有私密图纸。

- 建议：按模型/询价设置举报与法律或政策复核。依据具体投诉分级限制新共享或接单，按案授权阅证、留痕并提供申诉。
- 验收：第三方能提交最少必要的举报信息；受权职员只能在关联案件内阅证，有期限可撤销；无关模型和商家仍不受影响。
- 依据：[services/platform/trade-http.mjs:56](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/trade-http.mjs#L56)

#### O-14 · P2 · 运营能否知道客户大量停在哪一步、哪些商家响应慢，以及改版是否有效？

源码确认。后台业务统计只读工作区的订单状态和少量计数；店铺询价、首响、改价与接受在另外的会话表，不在该报表内。

即使订单数低，也不能区分没有商家接单、报价太慢、价格跳变或确认后缺少下单入口；推广和运营改善没有可靠基线。

- 建议：记录脱敏事件并定义上传、获得预算、选店、首响、发出有效报价、确认、支付和签收的漏斗；按工艺、地区及商家聚合。
- 验收：构造 10 个带重试的咨询、4 次首次回复和 2 个确认；后台按唯一定义显示 10/4/2，未回复单可分派，统计无需读取聊天全文或模型原件。
- 依据：[services/platform/admin-business.mjs:26](https://github.com/aHao030/Gongzao-Shared-3D/blob/2c64ca9d4ebbf596030c17ff3b8a15ea12195507/services/platform/admin-business.mjs#L26)

## 国内外平台做法及适用范围

- 按零件配置材料、后处理、数量和交期。订单审核通过后，客户可查看审核结果、确认付款，之后跟踪生产及快递。 可借鉴的做法是在报价、订单和生产记录里共用零件明细。不同交期可选分批发货或一起发货。 [嘉立创｜3D 打印下单流程](https://www.jlc.com/portal/server_guide_35104.html)
- 在 3D CAD 无法表达的螺纹、公差、粗糙度等要求上使用图纸；模型和图纸存在冲突时联系客户澄清。 可借鉴的做法是绑定两种文件的版本，明确尺寸和表面要求。发现冲突时暂停该零件，待双方确认再投产。 [Xometry｜模型、图纸与报价不一致](https://community.xometry.com/kb/articles/690-model-drawing-and-quote-discrepancies)
- 帮助中心按未按时发货、错发少发、运费未退等区分处理入口，部分场景从催单或售后升级为纠纷，可在原纠纷单中留言。 可借鉴的做法是在订单内按原因发起售后，超时升级；给双方显示当前处理人、证据和进度。响应时限由共造按服务能力制定。 [京东｜交易纠纷申请条件](https://help.jd.com/user/issue/452-1570.html)
- 升级后的案件沟通进入案件日志，可提交照片、实测尺寸和第三方评估，裁决结果通知双方。 可借鉴的做法是将工艺约定、出厂质检及买家实测放入同一售后单；支持按件补打、部分退款或给出驳回理由。 [Etsy｜How to Open a Case](https://help.etsy.com/hc/en-us/articles/5745586898199-How-to-Open-a-Case?segment=shopping)
- 在该产品模式中，向买家退款不会自动撤回已给商家的转账。平台需单独核对并处理关联资金变动。 可借鉴的做法是为收款、商家应付、实际转账、退款及转账冲正分别记流水。按订单验证四方金额是否一致，并核对渠道可用地区和合同。 [Stripe Connect｜独立收款与转账](https://docs.stripe.com/connect/separate-charges-and-transfers)
- 部分特殊件的工艺工时会产生附加费用，最终价格和交期在工程师审查后确定。 可借鉴的做法是为修改报价记录旧价、新价、原因和交期变化，向客户发出可接受或拒绝的修订。 [JLC3DP｜特殊件附加费用](https://jlc3dp.com/help/article/3d-printing-special-charges-case)
- 可在指定层加入换色暂停，切片视图能显示预计换色时间，供人工值守安排。预览里选择的颜色本身没有改变打印指令的效果。 可借鉴的做法是凸字铭牌可以先评估一次层间换色，报价单标注换色层和人工值守。 [Prusa｜按层换色](https://help.prusa3d.com/article/color-change_1687?product=prusaslicer)
- 对文档描述的多料配置，同板复制件可共用擦拭塔。塔体积受各层换色次数和清洗量影响。 可借鉴的做法是用指定设备、色序、排版的整板切片核算工时和废料；仅切片未含的人工或额外工序可另计。 [Prusa｜擦拭塔与清洗量](https://help.prusa3d.com/article/wipe-tower_125010?product=mmu1)
- 官方说明区分喷涂区域、光面/哑面色卡和屏幕色差，并提醒装配须考虑涂层厚度。 可借鉴的做法是对喷漆另附色号、遮蔽与验收面，确认外观样或实物色卡，另列后处理费用及时间。 [嘉立创｜喷漆表面与色卡](https://www.jlc.com/portal/q7i40794.html)

测试覆盖目前发布的能力。实际两家商户试运营、量产切片对称重计时、实机断线恢复、真实运单和渠道资金对账仍须分别验收。此文记录审查与设计方案。
