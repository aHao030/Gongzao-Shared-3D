import { createHash } from 'node:crypto';
import { check,IntegrationError } from './config.mjs';
const TYPES=new Set(['analysis','slice','schedule','tracking-poll','notification']);
const digest=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value);
/** Optional worker-side transport; DB lease + ledger remain the source of business truth. */
export async function createBullTaskQueue({connection,prefix='gongzao',QueueClass}={}){
  check(connection&&typeof connection==='object','QUEUE_NOT_CONFIGURED','请配置独立 Redis 任务服务',503);
  check(/^[A-Za-z0-9_-]{1,50}$/.test(prefix),'INVALID_QUEUE','队列前缀无效',400);
  let Queue=QueueClass;if(!Queue)try{({Queue}=await import('bullmq'));}catch{throw new IntegrationError('QUEUE_DEPENDENCY_MISSING','请在 services/integrations 中安装选配依赖',503);}
  const queue=new Queue('manufacturing',{connection,prefix});
  return {
    async enqueue({ownerId,taskId,type,payload}){
      check(typeof ownerId==='string'&&ownerId.length>0&&typeof taskId==='string'&&taskId.length>0&&TYPES.has(type),'INVALID_QUEUE_TASK','队列只接收计算、查询和通知任务',400);
      const encoded=stable(payload);check(encoded&&Buffer.byteLength(encoded)<=32768,'INVALID_QUEUE_TASK','任务数据过大',400);
      const jobId=digest(ownerId+':'+taskId),fingerprint=digest(type+':'+encoded),old=await queue.getJob(jobId);
      if(old){check(old.data.fingerprint===fingerprint,'QUEUE_TASK_CONFLICT','同一任务已绑定不同内容',409);return {jobId,replayed:true};}
      const job=await queue.add(type,{ownerId,taskId,type,payload,fingerprint},{jobId,attempts:3,backoff:{type:'exponential',delay:2000},removeOnComplete:false,removeOnFail:false});
      const saved=await queue.getJob(job.id);check(saved?.data.fingerprint===fingerprint,'QUEUE_TASK_CONFLICT','并发任务内容冲突',409);return {jobId:job.id,replayed:false};
    },
    async health(){const counts=await queue.getJobCounts('waiting','active','failed','completed');return {configured:true,counts};},
    close:()=>queue.close()
  };
}
