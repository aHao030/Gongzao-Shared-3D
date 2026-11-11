import { loadIntegrationConfig,createIntegrationHub } from './index.mjs';
const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
try {
  const config=await loadIntegrationConfig(arg('--config'));
  const hub=createIntegrationHub({config}),context={ownerId:config.ownerId};
  const command=args[0]||'status';let result;
  if(command==='status')result=hub.status(context);
  else if(command==='probe')result=await hub.probe(arg('--service'),context);
  else if(command==='spools')result=await hub.spools(context);
  else if(command==='tracking')result=await hub.tracking({carrier:arg('--carrier'),trackingNumber:arg('--tracking')},context);
  else throw new Error('可用命令：status、probe、spools、tracking');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){process.stderr.write(JSON.stringify({error:{code:error.code||'COMMAND_FAILED',message:error.code?error.message:'命令执行失败，请检查配置与参数'}})+'\n');process.exitCode=1;}
