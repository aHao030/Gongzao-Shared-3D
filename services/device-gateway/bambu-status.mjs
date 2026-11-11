import tls from 'node:tls';
import { createHash, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GatewayError, isPrivateIPv4 } from './config.mjs';

// Bambu Studio's public printer CA bundle, unchanged from upstream blob
// 6d8dbcb39bdc068c9adac668193fba6a6b85b1d5 (resources/cert/printer.cer).
const caFile = new URL('./bambu-printer-ca.cer', import.meta.url);
const MAX_PACKET = 256 * 1024;
const MAX_BYTES = 1024 * 1024;
const MAX_PACKETS = 128;
const snapshotInterval = 5 * 60 * 1000;
const lastSnapshot = new Map();
const snapshotBody = Buffer.from('{"pushing":{"sequence_id":"0","command":"pushall","version":1,"push_target":1}}');
const stateNames = new Map(Object.entries({
  IDLE:'idle', RUNNING:'printing', PAUSE:'paused', FINISH:'completed',
  FAILED:'failed', PREPARE:'preparing', SLICING:'preparing',
}));
const fail = (code, message) => new GatewayError(code, message);
const protocolError = () => fail('BAMBU_PROTOCOL_ERROR','打印机返回了不支持的状态协议');
const identityError = () => fail('BAMBU_CERTIFICATE_MISMATCH','打印机证书与受信设备不匹配，请在本地核对串号及证书');

function mqttText(value) {
  const bytes = Buffer.from(value,'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length,bytes]);
}

function outgoing(header, body) {
  if (body.length > 16383) throw protocolError();
  const length = body.length < 128 ? [body.length] : [128 | (body.length % 128), Math.floor(body.length / 128)];
  return Buffer.concat([Buffer.from([header,...length]),body]);
}

function requestStatusSnapshot(socket,serial) {
  const now = performance.now();
  for (const [key,sent] of lastSnapshot) if (now-sent >= snapshotInterval) lastSnapshot.delete(key);
  if (lastSnapshot.has(serial) || lastSnapshot.size >= 256) return;
  lastSnapshot.set(serial,now);
  // P1 firmware sends field deltas; the printer handles this single fixed
  // query by reporting a snapshot. Never accept a caller-supplied command.
  socket.write(outgoing(0x30,Buffer.concat([mqttText('device/'+serial+'/request'),snapshotBody])));
}

// MQTT's variable-length header and payload can span arbitrary TCP reads. Only
// allocate a payload after checking its complete length and fill each byte once.
function packetReader(consume) {
  let header = null, remaining = 0, lengthBytes = 0, payload = null, written = 0;
  let byteCount = 0, packetCount = 0;
  return chunk => {
    byteCount += chunk.length;
    if (byteCount > MAX_BYTES) throw protocolError();
    for (let pos = 0; pos < chunk.length;) {
      if (header === null) { header = chunk[pos++]; continue; }
      if (payload === null) {
        const digit = chunk[pos++];
        remaining += (digit & 127) * 128 ** lengthBytes++;
        if (remaining > MAX_PACKET || (lengthBytes === 4 && digit >= 128)) throw protocolError();
        if (digit >= 128) continue;
        if (lengthBytes > 1 && digit === 0) throw protocolError();
        payload = Buffer.allocUnsafe(remaining);
      }
      const n = Math.min(payload.length-written,chunk.length-pos);
      chunk.copy(payload,written,pos,pos+n);
      pos += n;
      written += n;
      if (written === remaining) {
        if (++packetCount > MAX_PACKETS) throw protocolError();
        if (consume(header,payload)) return;
        header = null; remaining = lengthBytes = written = 0; payload = null;
      }
    }
  };
}

function inspectReport(body, topic) {
  if (body.length < 2) throw protocolError();
  const length = body.readUInt16BE(0);
  if (length + 2 > body.length) throw protocolError();
  if (!body.subarray(2,2+length).equals(topic)) return null;
  let event;
  try { event = JSON.parse(body.toString('utf8',2+length)); }
  catch { throw protocolError(); }
  const print = event?.print;
  if (print?.command !== 'push_status') return null;
  const state = print.gcode_state;
  // Periodic reports may be deltas containing only a temperature. No state
  // establishes neither readiness nor a percentage inherited from a past job.
  if (typeof state !== 'string' || !state.trim()) return {delta:true};
  const pct = print.mc_percent;
  return {printState:stateNames.get(state.toUpperCase()) ?? 'unknown',
    progressPercent:Number.isInteger(pct) && pct >= 0 && pct <= 100 ? pct : null};
}

function verifyPeer(peer, serial, expectedPin) {
  if (!peer?.raw) throw identityError();
  const cert = new X509Certificate(peer.raw);
  const matchingName = cert.checkHost(serial,{wildcards:false});
  if (!matchingName || matchingName.toUpperCase() !== serial) throw identityError();
  if (expectedPin) {
    const now = Date.now();
    if (!(Date.parse(cert.validFrom) <= now && now <= Date.parse(cert.validTo)) ||
        !timingSafeEqual(createHash('sha256').update(peer.raw).digest(),expectedPin)) throw identityError();
  }
}

/**
 * One bounded, read-only observation from an operator-authorized LAN printer.
 * The access code is written only after verifying the device. An explicit leaf
 * pin is a local trust anchor for this device; a failed CA check never falls
 * back automatically to a pin or to an unverified connection.
 */
export async function readBambuStatus({host,serial,accessCode,certificateFingerprint} = {}, {
  allowLoopback=false, port=8883, timeoutMs=4500, ca,
} = {}) {
  const localTest = allowLoopback && host === '127.0.0.1';
  if (typeof host !== 'string' || (!isPrivateIPv4(host) && !localTest) ||
      typeof serial !== 'string' || !/^[A-Z0-9]{6,32}$/.test(serial) ||
      !Number.isInteger(port) || port < 1 || port > 65535 || (port !== 8883 && !localTest) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 25 || timeoutMs > 15000)
    throw fail('BAMBU_INVALID_TARGET','请核对授权设备的局域网地址和机身序列号');
  if (typeof accessCode !== 'string' || !/^[A-Za-z0-9]{8}$/.test(accessCode))
    throw fail('BAMBU_AUTH_REQUIRED','请在本地网关配置本机的局域网访问码');
  let expectedPin;
  if (certificateFingerprint !== undefined && certificateFingerprint !== '') {
    if (typeof certificateFingerprint !== 'string' ||
        !/^(?:[a-fA-F0-9]{64}|(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2})$/.test(certificateFingerprint))
      throw identityError();
    expectedPin = Buffer.from(certificateFingerprint.replaceAll(':',''),'hex');
  }
  const authorities = expectedPin ? undefined : ca ?? await readFile(caFile).catch(() => {
    throw fail('BAMBU_TRUST_REQUIRED','网关缺少打印机的受信证书，请核对安装文件');
  });
  const topic = Buffer.from('device/'+serial+'/report');
  return new Promise((resolve,reject) => {
    let stage = 'tls', sawDelta = false, finished = false, snapshotTimer, earlyReport;
    const socket = tls.connect({
      host, port, servername:serial, minVersion:'TLSv1.2', ca:authorities,
      rejectUnauthorized:!expectedPin,
      checkServerIdentity(_name,peer) { try { verifyPeer(peer,serial); } catch { return identityError(); } },
    });
    const finish = (error,result) => {
      if (finished) return;
      finished = true; clearTimeout(deadline); clearTimeout(snapshotTimer); socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    const deadline = setTimeout(() => {
      if (stage === 'report' && sawDelta) finish(null,{printState:'unknown',progressPercent:null});
      else if (stage === 'report') finish(fail('BAMBU_STATUS_UNAVAILABLE','已获准订阅，但尚未收到本机的新状态报告'));
      else finish(fail('BAMBU_CONNECTION_FAILED','连接打印机超时，请检查设备网络和固件设置'));
    },timeoutMs);
    socket.once('secureConnect',() => {
      try {
        verifyPeer(socket.getPeerCertificate(),serial,expectedPin);
        stage = 'connack';
        const client = 'gz'+randomBytes(8).toString('hex');
        // Protocol level 4, username/password, clean session, keepalive 15 seconds.
        const fields = [mqttText('MQTT'),Buffer.from([4,0xc2,0,15]),mqttText(client),mqttText('bblp'),mqttText(accessCode)];
        socket.write(outgoing(0x10,Buffer.concat(fields)));
      } catch { finish(identityError()); }
    });
    const parse = packetReader((header,body) => {
      if (stage === 'connack') {
        if (header !== 0x20 || body.length !== 2 || body[0] !== 0) throw protocolError();
        if ([4,5].includes(body[1])) throw fail('BAMBU_AUTH_REQUIRED','打印机未接受局域网访问码或本地访问权限');
        if (body[1] !== 0) throw fail('BAMBU_CONNECTION_FAILED','打印机未接受状态连接');
        stage = 'suback';
        // Packet identifier 1; subscribe to this serial's report topic at QoS 0.
        socket.write(outgoing(0x82,Buffer.concat([Buffer.from([0,1]),mqttText(topic),Buffer.from([0])])));
      } else if (stage === 'suback' && header === 0x30) {
        // MQTT 3.1.1 permits a broker to start delivering PUBLISH packets
        // before SUBACK. Hold their evidence until the grant is validated.
        const report = inspectReport(body,topic);
        if (report?.delta) sawDelta = true;
        else if (report) earlyReport = report;
      } else if (stage === 'suback' && header === 0x90) {
        if (body.length !== 3 || body.readUInt16BE(0) !== 1) throw protocolError();
        if (body[2] === 0x80) throw fail('BAMBU_AUTH_REQUIRED','设备未授权读取此序列号的状态');
        if (body[2] !== 0) throw protocolError();
        stage = 'report';
        if (earlyReport) finish(null,earlyReport);
        else snapshotTimer = setTimeout(() => {
          if (!finished) requestStatusSnapshot(socket,serial);
        },Math.min(850,Math.floor(timeoutMs/3)));
      } else if ((stage === 'report' || stage === 'suback') && header === 0x31) {
        // Retained messages can predate the scan. Wait for a fresh observation.
      } else if (stage === 'report' && header === 0x30) {
        const observation = inspectReport(body,topic);
        if (observation?.delta) sawDelta = true;
        else if (observation) finish(null,observation);
      } else throw protocolError();
      return finished;
    });
    socket.on('data',chunk => {
      if (finished) return;
      try { parse(chunk); } catch (error) { finish(error instanceof GatewayError ? error : protocolError()); }
    });
    socket.once('error',error => {
      const trustError = error.code === 'BAMBU_CERTIFICATE_MISMATCH' || /CERT|ISSUER|SELF_SIGNED|LEAF_SIGNATURE/.test(error.code ?? '');
      finish(trustError ? identityError() : fail('BAMBU_CONNECTION_FAILED','无法连接本地打印机'));
    });
    socket.once('close',() => finish(fail('BAMBU_CONNECTION_FAILED','打印机状态连接已断开')));
  });
}
