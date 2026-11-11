import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { generateKeyPairSync, sign, X509Certificate, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readBambuStatus } from '../services/device-gateway/bambu-status.mjs';

// Generate an ephemeral TLS identity using Node alone, so the test suite works
// on a Windows installation without an OpenSSL CLI or a stored private key.
function der(tag, ...parts) {
  const content = Buffer.concat(parts);
  const count = content.length > 255 ? [0x82, content.length >> 8, content.length & 255]
    : content.length > 127 ? [0x81, content.length] : [content.length];
  return Buffer.concat([Buffer.from([tag,...count]),content]);
}
function tlsIdentity(serial) {
  const {privateKey,publicKey} = generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const algorithm = Buffer.from('300a06082a8648ce3d040302','hex');
  const name = der(0x30,der(0x31,der(0x30,Buffer.from('0603550403','hex'),der(0x0c,Buffer.from(serial)))));
  const validity = der(0x30,der(0x17,Buffer.from('240101000000Z')),der(0x17,Buffer.from('490101000000Z')));
  const tbs = der(0x30,Buffer.from([2,1,1]),algorithm,name,validity,name,publicKey.export({type:'spki',format:'der'}));
  const cert = new X509Certificate(der(0x30,tbs,algorithm,der(3,Buffer.from([0]),sign('sha256',tbs,privateKey))));
  return {cert:cert.toString(),key:privateKey.export({type:'pkcs8',format:'pem'}),fingerprint:cert.fingerprint256};
}
function frame(type,data) {
  const n = data.length;
  return Buffer.concat([Buffer.from(n < 128 ? [type,n] : [type,128 | n % 128,Math.floor(n / 128)]),data]);
}
function mqttText(str) {
  const text = Buffer.from(str), length = Buffer.alloc(2);
  length.writeUInt16BE(text.length);
  return Buffer.concat([length,text]);
}
function published(topic,report,retained=false) {
  return frame(retained?0x31:0x30,Buffer.concat([mqttText(topic),Buffer.from(JSON.stringify(report))]));
}
function takeText(data,offset=0) {
  const size = data.readUInt16BE(offset), next = offset+2+size;
  assert.ok(next <= data.length);
  return [data.toString('utf8',offset+2,next),next];
}
const ack = Buffer.from([0x20,2,0,0]);
const grant = Buffer.from([0x90,3,0,1,0]);
const report = (state='RUNNING',pct=35) => ({print:{command:'push_status',gcode_state:state,mc_percent:pct,
  subtask_name:'private filename',nozzle_temper:215}});

async function mockPrinter(t,serial,respond) {
  const identity = tlsIdentity(serial), received = [], sockets = new Set();
  const server = tls.createServer(identity,socket => {
    let buffer = Buffer.alloc(0);
    socket.on('error',() => {});
    socket.on('data',chunk => {
      buffer = Buffer.concat([buffer,chunk]);
      while (buffer.length >= 2) {
        const long = buffer[1] >= 128, start = long ? 3 : 2;
        if (buffer.length < start) break;
        const size = (buffer[1] & 127) + (long ? 128 * buffer[2] : 0);
        if (buffer.length < start+size) break;
        const type = buffer[0], body = buffer.subarray(start,start+size);
        received.push(type);
        buffer = buffer.subarray(start+size);
        respond({type,body,socket,topic:'device/'+serial+'/report'});
      }
    });
  });
  server.on('connection',socket => {sockets.add(socket); socket.once('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
  const target={host:'127.0.0.1',serial,accessCode:'TESTCODE'};
  const opts={port:server.address().port,allowLoopback:true,ca:identity.cert,timeoutMs:700};
  return {read:(override={},options={})=>readBambuStatus({...target,...override},{...opts,...options}),received,identity};
}

test('vendor trust store is the published Bambu Studio device certificate bundle',async()=>{
  const bytes=await readFile(new URL('../services/device-gateway/bambu-printer-ca.cer',import.meta.url));
  const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  assert.equal(blob,'6d8dbcb39bdc068c9adac668193fba6a6b85b1d5');
  assert.ok(!bytes.includes('PRIVATE KEY'));
});

test('real TLS verifies serial and MQTT credentials, subscribes only to one topic and exposes a fresh report',async t=>{
  const serial='01P00TEST001';
  const printer=await mockPrinter(t,serial,({type,body,socket,topic})=>{
    if(type===0x10){
      const [protocol,cursor]=takeText(body);assert.equal(protocol,'MQTT');
      assert.deepEqual([...body.subarray(cursor,cursor+4)],[4,0xc2,0,15]);
      const [client,afterClient]=takeText(body,cursor+4);assert.match(client,/^gz[a-f0-9]{16}$/);
      const [user,afterUser]=takeText(body,afterClient);assert.equal(user,'bblp');
      const [password,end]=takeText(body,afterUser);assert.equal(password,'TESTCODE');assert.equal(end,body.length);
      socket.write(ack);return;
    }
    assert.equal(type,0x82);assert.equal(body.readUInt16BE(0),1);
    const [subscribed,last]=takeText(body,2);assert.equal(subscribed,topic);assert.equal(body[last],0);
    const packets=Buffer.concat([grant,published(topic,report('IDLE'),true),published('device/OTHER/report',report('IDLE')),published(topic,report())]);
    socket.write(packets.subarray(0,1));setImmediate(()=>socket.write(packets.subarray(1)));
  });
  assert.deepEqual(await printer.read(),{printState:'printing',progressPercent:35});
  assert.deepEqual(printer.received,[0x10,0x82]);
});

test('vendor chain, exact serial and optional approved fingerprint protect the access code before MQTT',async t=>{
  const serial='01S00TEST002';
  const p=await mockPrinter(t,serial,({type,socket,topic})=>{
    if(type===0x10)socket.write(ack);
    else {assert.equal(type,0x82);socket.write(Buffer.concat([published(topic,report('IDLE',null)),grant]));}
  });
  await assert.rejects(p.read({},{ca:undefined}),{code:'BAMBU_CERTIFICATE_MISMATCH'});
  await assert.rejects(p.read({serial:'01S00WRONG00'}),{code:'BAMBU_CERTIFICATE_MISMATCH'});
  await assert.rejects(p.read({certificateFingerprint:'00'.repeat(32)}),{code:'BAMBU_CERTIFICATE_MISMATCH'});
  await assert.rejects(p.read({serial:'01S00WRONG00',certificateFingerprint:p.identity.fingerprint}),{code:'BAMBU_CERTIFICATE_MISMATCH'});
  assert.deepEqual(p.received,[]);
  assert.deepEqual(await p.read({certificateFingerprint:p.identity.fingerprint},{ca:undefined}),{printState:'idle',progressPercent:null});
});

test('fresh denied CONNECT or SUBACK, even after an early publish, never establishes an observation',async t=>{
  const denied=await mockPrinter(t,'01S00TEST003',({socket})=>socket.write(Buffer.from([0x20,2,0,5])));
  await assert.rejects(denied.read(),{code:'BAMBU_AUTH_REQUIRED'});
  assert.deepEqual(denied.received,[0x10]);
  const topicDenied=await mockPrinter(t,'01S00TEST004',({type,socket,topic})=>{
    socket.write(type===0x10?ack:Buffer.concat([published(topic,report()),Buffer.from([0x90,3,0,1,0x80])]));
  });
  await assert.rejects(topicDenied.read(),{code:'BAMBU_AUTH_REQUIRED'});
});

test('incremental devices may receive one fixed status query per five minutes; missing state cannot become idle',async t=>{
  const serial='01S00TEST005';
  const p=await mockPrinter(t,serial,({type,body,socket,topic})=>{
    if(type===0x10)return socket.write(ack);
    if(type===0x82)return socket.write(Buffer.concat([grant,published(topic,{print:{command:'push_status',nozzle_temper:180}})]));
    assert.equal(type,0x30);const [query,cursor]=takeText(body);assert.equal(query,'device/'+serial+'/request');
    assert.deepEqual(JSON.parse(body.toString('utf8',cursor)),{pushing:{sequence_id:'0',command:'pushall',version:1,push_target:1}});
    socket.write(published(topic,report('PAUSE',25)));
  });
  assert.deepEqual(await p.read(),{printState:'paused',progressPercent:25});
  assert.deepEqual(await p.read(),{printState:'unknown',progressPercent:null});
  assert.deepEqual(p.received,[0x10,0x82,0x30,0x10,0x82]);
});

test('retained or wrong-topic messages alone never prove live printer state',async t=>{
  const p=await mockPrinter(t,'01S00TEST006',({type,socket,topic})=>{
    if(type===0x10)socket.write(ack);
    if(type===0x82)socket.write(Buffer.concat([grant,published(topic,report(),true),published('device/WRONG/report',report())]));
  });
  await assert.rejects(p.read(),{code:'BAMBU_STATUS_UNAVAILABLE'});
});

test('oversized MQTT input is bounded; invalid configuration cannot open a socket',async t=>{
  const p=await mockPrinter(t,'01S00TEST007',({socket})=>socket.write(Buffer.from([0x30,0xff,0xff,0x7f])));
  await assert.rejects(p.read(),{code:'BAMBU_PROTOCOL_ERROR'});
  await assert.rejects(p.read({accessCode:'bad'}),{code:'BAMBU_AUTH_REQUIRED'});
  await assert.rejects(p.read({host:'8.8.8.8'}),{code:'BAMBU_INVALID_TARGET'});
  await assert.rejects(p.read({serial:'01S/#'}),{code:'BAMBU_INVALID_TARGET'});
  assert.deepEqual(p.received,[0x10]);
});
