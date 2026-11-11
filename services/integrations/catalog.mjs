/** Worker-safe status view: no network, process, secret or filesystem dependency. */
export const INTEGRATION_CATALOG=[
 ['spoolman','耗材库存','READ_ONLY',['inventory','usage'],'读取耗材余额；采购价与订单预留由平台维护'],
 ['fdmMonster','农场工作台','READ_ONLY',['printers'],'读取设备列表；Bambu 兼容性需现场验证'],
 ['obico','打印异常监控','READ_ONLY',['printers','alerts'],'读取监控状态；告警不能替代人工质检'],
 ['karrio','物流服务','READ_ONLY',['rates','tracking'],'查询运价与物流；签收后仍需客户验收'],
 ['hyperswitch','支付通道','TEST_ONLY',['test-payment-intent','payment-status'],'仅测试意向与状态；真实收款和分账未启用'],
 ['moonraker','Klipper 设备','CONTROL_GATED',['status','guarded-upload','guarded-start'],'真机启动需要独立生产资格，沙盒订单不能启动'],
 ['octoprint','OctoPrint 设备','CONTROL_GATED',['status','guarded-upload','guarded-start'],'真机启动需要独立生产资格，沙盒订单不能启动']
];
export function unconfiguredStatus(){return {services:INTEGRATION_CATALOG.map(([id,label,mode,capabilities])=>({id,label,mode,capabilities:[...capabilities],configured:false,state:'NOT_CONFIGURED',message:'尚未为当前工作空间配置；请由管理员配置服务器连接'})),realPayments:false,realDeviceDispatch:false};}
