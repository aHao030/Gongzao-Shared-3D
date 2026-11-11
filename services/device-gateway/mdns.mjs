import dgram from 'node:dgram';
import os from 'node:os';
import { isPrivateIPv4 } from './config.mjs';

export const SERVICES={'_moonraker._tcp.local':'moonraker','_octoprint._tcp.local':'octoprint'};
const uint32=ip=>ip.split('.').reduce((n,v)=>((n<<8)|Number(v))>>>0,0);
export function localIPv4Interfaces(interfaces=os.networkInterfaces()) {
  return Object.values(interfaces).flat().filter(x=>x&&x.family==='IPv4'&&!x.internal&&isPrivateIPv4(x.address)&&/^\d+\.\d+\.\d+\.\d+$/.test(x.netmask)).slice(0,8);
}
export function sameSubnet(address,interfaces) {
  if(!isPrivateIPv4(address))return false;
  return interfaces.some(item=>{const mask=uint32(item.netmask),ip=uint32(address),own=uint32(item.address);return (ip&mask)===(own&mask)&&(ip&~mask)!==0&&(ip&~mask)!==(~mask);});
}
function encodeName(name) {return Buffer.concat([...name.split('.').map(part=>{const bytes=Buffer.from(part);return Buffer.concat([Buffer.from([bytes.length]),bytes]);}),Buffer.from([0])]);}
export function buildQuery() {
  const header=Buffer.alloc(12);header.writeUInt16BE(Object.keys(SERVICES).length,4);
  return Buffer.concat([header,...Object.keys(SERVICES).map(name=>Buffer.concat([encodeName(name),Buffer.from([0,12,0x80,1])]))]);
}
function readName(buffer,start) {
  let offset=start,end=null,steps=0,total=0;const labels=[],seen=new Set();
  for(;;){
    if(offset>=buffer.length||++steps>64||seen.has(offset))throw new Error('Invalid DNS name');seen.add(offset);
    const length=buffer[offset];
    if((length&0xc0)===0xc0){if(offset+1>=buffer.length)throw new Error('Invalid DNS pointer');if(end===null)end=offset+2;offset=((length&0x3f)<<8)|buffer[offset+1];continue;}
    if(length&0xc0)throw new Error('Invalid DNS label');offset++;
    if(length===0){if(end===null)end=offset;break;}
    if(offset+length>buffer.length||length>63||++total>32)throw new Error('Invalid DNS label');
    const label=buffer.subarray(offset,offset+length).toString('utf8');if(/[\0-\x1f\x7f]/.test(label))throw new Error('Invalid DNS text');labels.push(label);offset+=length;
  }
  const name=labels.join('.').toLowerCase();if(name.length>253)throw new Error('DNS name too long');return {name,next:end};
}
export function parsePacket(input) {
  const b=Buffer.from(input);if(b.length<12||b.length>9000)throw new Error('Invalid DNS packet size');
  const questions=b.readUInt16BE(4),count=b.readUInt16BE(6)+b.readUInt16BE(8)+b.readUInt16BE(10);
  if(questions>32||count>128)throw new Error('DNS packet limits');let offset=12;const records=[];
  for(let i=0;i<questions;i++){offset=readName(b,offset).next+4;if(offset>b.length)throw new Error('Truncated DNS question');}
  for(let i=0;i<count;i++){
    const n=readName(b,offset);offset=n.next;if(offset+10>b.length)throw new Error('Truncated DNS record');
    const type=b.readUInt16BE(offset),klass=b.readUInt16BE(offset+2)&0x7fff,ttl=b.readUInt32BE(offset+4),size=b.readUInt16BE(offset+8),start=offset+10,end=start+size;
    if(end>b.length)throw new Error('Truncated DNS data');offset=end;if(klass!==1||ttl===0)continue;
    if(type===1&&size===4)records.push({name:n.name,type:'A',address:[...b.subarray(start,end)].join('.')});
    if(type===12){const ptr=readName(b,start);if(ptr.next>end)throw new Error('Invalid PTR data');records.push({name:n.name,type:'PTR',target:ptr.name});}
    if(type===33&&size>=7){const srv=readName(b,start+6);if(srv.next>end)throw new Error('Invalid SRV data');records.push({name:n.name,type:'SRV',port:b.readUInt16BE(start+4),target:srv.name});}
  }
  return records;
}
export function candidatesFromRecords(records,interfaces) {
  const out=[],seen=new Set();
  for(const ptr of records){
    const protocol=ptr.type==='PTR'?SERVICES[ptr.name]:null;if(!protocol)continue;
    const srv=records.find(r=>r.type==='SRV'&&r.name===ptr.target&&r.port>0);if(!srv)continue;
    for(const addr of records.filter(r=>r.type==='A'&&r.name===srv.target)){
      if(!sameSubnet(addr.address,interfaces))continue;
      const endpoint=`http://${addr.address}:${srv.port}`,key=protocol+'|'+endpoint;if(seen.has(key))continue;seen.add(key);
      out.push({protocol,endpoint,name:ptr.target.slice(0,-(ptr.name.length+1)).slice(0,80)});if(out.length===32)return out;
    }
  }
  return out;
}
export async function discoverMdns({interfaces=localIPv4Interfaces(),durationMs=1600,createSocket=dgram.createSocket}={}) {
  if(!interfaces.length)return {targets:[],diagnostics:['NO_LOCAL_IPV4_INTERFACE']};
  const records=[],diagnostics=[];let packets=0;
  await new Promise(resolve=>{
    const socket=createSocket({type:'udp4',reuseAddr:true});let done=false,timer;
    const finish=code=>{if(done)return;done=true;clearTimeout(timer);if(code)diagnostics.push(code);try{socket.close();}catch{}resolve();};
    socket.on('error',()=>finish('MDNS_SOCKET_UNAVAILABLE'));
    socket.on('message',(message,rinfo)=>{
      if(++packets>128||!sameSubnet(rinfo.address,interfaces))return;
      try{records.push(...parsePacket(message));if(records.length>2048)records.splice(2048);}catch{/* Ignore malformed unsolicited packets. */}
    });
    timer=setTimeout(()=>finish(),Math.min(3000,Math.max(100,durationMs)));
    try{socket.bind(0,async()=>{
      if(done)return;
      try{socket.setMulticastTTL(255);for(const item of interfaces){if(done)break;socket.setMulticastInterface(item.address);await new Promise(resolve=>socket.send(buildQuery(),5353,'224.0.0.251',error=>{if(error&&!diagnostics.includes('MDNS_SEND_FAILED'))diagnostics.push('MDNS_SEND_FAILED');resolve();}));}}
      catch{finish('MDNS_SOCKET_UNAVAILABLE');}
    });}catch{finish('MDNS_SOCKET_UNAVAILABLE');}
  });
  return {targets:candidatesFromRecords(records,interfaces),diagnostics};
}
