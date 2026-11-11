import dgram from 'node:dgram';
import { createHash } from 'node:crypto';
import { localIPv4Interfaces, sameSubnet } from './mdns.mjs';

// Source: BambuStudio 930fe93851afbc76b1c64dd37d8728b6a9afc89c,
// resources/printers/<code>.json, display_name and sn_prefix. A code maps
// an advertised model; it does not certify the hardware or its firmware.
const models = [
  ['BL-P001', '00M', 'X1 Carbon'], ['BL-P002', '00W', 'X1'],
  ['C11', '01S', 'P1P'], ['C12', '01P', 'P1S'], ['C13', '03W', 'X1E'],
  ['N1', '030', 'A1 mini'], ['N2S', '039', 'A1'], ['N7', '22E', 'P2S'],
  ['O1D', '094', 'H2D'], ['O1S', '093', 'H2S'], ['O1E', '239', 'H2D Pro'],
  ['O1C', '31B', 'H2C'], ['O1C2', '31B', 'H2C']
];
const byCode = new Map(models.map(([code, , name]) => [code, name]));
byCode.set('3DPRINTER-X1-CARBON', 'X1 Carbon');
byCode.set('3DPRINTER-X1', 'X1');
const byPrefix = new Map(models.map(([, prefix, name]) => [prefix, name]));
const service = 'urn:bambulab-com:device:3dprinter:1';
const multicast = '239.255.255.250';
const unknownModel = 'Bambu Lab（型号待核对）';

export function bambuSerialModel(serial) {
  const name = byPrefix.get(serial.slice(0, 3));
  return name ? 'Bambu Lab ' + name : unknownModel;
}

// Only the UDP source address may become the endpoint. No URL, hostname,
// credential, arbitrary topic or port from an advertisement is followed.
export function parseBambuAdvertisement(packet, sourceAddress, interfaces) {
  if (!Buffer.isBuffer(packet) || packet.length > 8192) return null;
  const nic = interfaces.find(item => sameSubnet(sourceAddress,[item]));
  if (!nic) return null;
  const lines = packet.toString('utf8').trimEnd().split(/\r?\n/);
  if (lines.shift() !== 'NOTIFY * HTTP/1.1' || lines.length > 48) return null;
  const headers = new Map();
  for (const line of lines) {
    const match = /^([a-zA-Z0-9.-]+):[ \t]*([^\x00-\x1F\x7F]*)$/.exec(line);
    if (!match) return null;
    const key = match[1].toLowerCase();
    if (headers.has(key)) return null;
    headers.set(key, match[2].trim());
  }
  if (headers.get('nt')?.toLowerCase() !== service || headers.get('nts')?.toLowerCase() !== 'ssdp:alive' ||
      headers.get('location') !== sourceAddress) return null;
  const serial = (headers.get('usn') ?? '').toUpperCase();
  const code = (headers.get('devmodel.bambu.com') ?? '').toUpperCase();
  if (!/^[A-Z0-9]{10,32}$/.test(serial) || !/^[A-Z0-9-]{1,40}$/.test(code)) return null;
  const fromCode = byCode.get(code), fromPrefix = byPrefix.get(serial.slice(0, 3));
  if (fromCode && fromPrefix && fromCode !== fromPrefix) return null;
  const model = fromCode ? 'Bambu Lab ' + fromCode : unknownModel;
  // Device names are merchant-visible. Some firmware defaults to its serial.
  const suppliedName = (headers.get('devname.bambu.com') ?? '').replaceAll(new RegExp(serial,'gi'), '…' + serial.slice(-4)).slice(0,80);
  // Kept inside the gateway for DHCP re-binding. The sender cannot provide
  // this boundary: both the interface and its mask came from the local OS.
  return { host:sourceAddress, serial, model, name:suppliedName || model,
    lan:{address:nic.address,netmask:nic.netmask} };
}

function unambiguousAdvertisements(observations) {
  const bySerial = new Map(), byHost = new Map(), disputed = new Set();
  for (const item of observations) {
    const previous = bySerial.get(item.serial), occupant = byHost.get(item.host);
    if (previous && (previous.host !== item.host || previous.model !== item.model)) disputed.add(item.serial);
    if (occupant && occupant !== item.serial) { disputed.add(occupant); disputed.add(item.serial); }
    bySerial.set(item.serial,item);
    byHost.set(item.host,item.serial);
  }
  const disputedHosts = new Set(observations.filter(item=>disputed.has(item.serial)).map(item=>item.host));
  return { advertisements:[...bySerial.values()].filter(item => !disputed.has(item.serial)),
    diagnostics:disputed.size ? ['BAMBU_DISCOVERY_IDENTITY_CONFLICT'] : [],
    ...(disputed.size ? {conflicts:{serials:[...disputed],hosts:[...disputedHosts]}} : {}) };
}

// Passive SSDP on the vendor's notification ports. Current devices may
// broadcast to 255.255.255.255 or use the multicast group on either port.
export async function discoverBambuLan({ interfaces = localIPv4Interfaces(), durationMs = 10500, createSocket = dgram.createSocket } = {}) {
  if (!interfaces.length) return { advertisements:[], diagnostics:['NO_LOCAL_IPV4_INTERFACE'] };
  const observations = [], seen = new Set(), diagnostics = new Set();
  let packets = 0;
  async function listen(port) {
    await new Promise(resolve => {
      let socket, timer, closed = false;
      function finish(code) {
        if (closed) return;
        closed = true;
        if (code) diagnostics.add(code);
        clearTimeout(timer);
        try { socket?.close(); } catch { /* socket may not have bound */ }
        resolve();
      }
      try {
        socket = createSocket({type:'udp4',reuseAddr:true});
        socket.on('error', () => finish('BAMBU_LISTEN_UNAVAILABLE'));
        socket.on('message', (packet, info) => {
          if (++packets > 2048) { finish('BAMBU_PACKET_LIMIT'); return; }
          const item = parseBambuAdvertisement(packet, info.address, interfaces);
          if (!item) return;
          const key = [item.serial,item.host,item.model].join('|');
          if (seen.has(key)) return;
          if (seen.size >= 128) { diagnostics.add('BAMBU_DISCOVERY_LIMIT'); return; }
          seen.add(key);
          observations.push(item);
        });
        timer = setTimeout(() => finish(), Math.max(100,Math.min(15000,durationMs)));
        socket.bind(port, () => {
          if (closed) return;
          for (const nic of interfaces) {
            try { socket.addMembership(multicast, nic.address); }
            catch { diagnostics.add('BAMBU_MULTICAST_UNAVAILABLE'); }
          }
        });
      } catch { finish('BAMBU_LISTEN_UNAVAILABLE'); }
    });
  }
  await Promise.all([listen(1990),listen(2021)]);
  const result = unambiguousAdvertisements(observations);
  return {...result, diagnostics:[...new Set([...diagnostics,...result.diagnostics])] };
}

const stateNames = {idle:'IDLE',printing:'RUNNING',paused:'PAUSE',completed:'FINISH',failed:'FAILED',preparing:'PREPARE',unknown:'UNKNOWN'};
export const bambuDeviceKey = serial => createHash('sha256').update('bambu|' + serial).digest('hex');
const lastVerifiedAddresses = new WeakMap();

// The announcement may nominate a host but cannot authenticate it. The status
// reader verifies the original serial and pinned certificate or vendor trust
// chain before any credential leaves the gateway. The old configuration on
// disk stays intact; only a successfully authenticated address is remembered.
export function bambuTargets(printers, advertisements, conflicts = {}) {
  const bySerial = new Map(advertisements.map(item => [item.serial,item]));
  const byHost = new Map(advertisements.map(item => [item.host,item.serial]));
  const configuredHosts = new Map(printers.map(item => [item.host,item.serial]));
  const disputedSerials = new Set(conflicts.serials), disputedHosts = new Set(conflicts.hosts);
  const targets = [], diagnostics = [];
  for (const printer of printers) {
    const advertised = bySerial.get(printer.serial);
    const remembered = lastVerifiedAddresses.get(printer);
    const host = remembered?.configured === printer.host ? remembered.host : printer.host;
    const nextHost = advertised?.host ?? host;
    const configuredOwner = configuredHosts.get(nextHost);
    const advertisedOwner = byHost.get(nextHost);
    const changedLan = advertised && nextHost !== printer.host &&
      (!advertised.lan || !sameSubnet(printer.host,[advertised.lan]));
    if (disputedSerials.has(printer.serial) || disputedHosts.has(nextHost)) {
      diagnostics.push('BAMBU_DISCOVERY_IDENTITY_CONFLICT');
    } else if (changedLan || (configuredOwner && configuredOwner !== printer.serial) ||
        (advertisedOwner && advertisedOwner !== printer.serial)) {
      diagnostics.push('BAMBU_CONFIG_ADDRESS_CHANGED');
      if (advertised && !configuredOwner) targets.push({advertised});
    } else targets.push({printer,advertised,host:nextHost});
    bySerial.delete(printer.serial);
  }
  for (const advertised of bySerial.values()) {
    if (!configuredHosts.has(advertised.host) && !disputedHosts.has(advertised.host) &&
        !disputedSerials.has(advertised.serial)) targets.push({advertised});
  }
  return {targets,diagnostics};
}

export async function probeBambu({printer, advertised,host:nextHost}, {readStatus,allowLoopback=false}) {
  const {serial} = printer ?? advertised, host = nextHost ?? (printer ?? advertised).host;
  const deviceKey = bambuDeviceKey(serial);
  const model = advertised?.model ?? bambuSerialModel(serial);
  const candidate = {deviceKey,protocol:'bambu',endpoint:'mqtts://' + host + ':8883',
    name:(printer?.name || advertised?.name || model).replaceAll(new RegExp(serial,'gi'),'…'+serial.slice(-4)),model,
    connectionState:'authorization_required'};
  if (advertised) candidate.probeEvidence = {method:'SSDP',advertised:true};
  if (!printer) return candidate;
  try {
    const target = host === printer.host ? printer : {...printer,host};
    const report = await readStatus(target,{allowLoopback});
    lastVerifiedAddresses.set(printer,{configured:printer.host,host});
    const proof = {method:'MQTT_TLS',advertised:Boolean(advertised),
      printState:stateNames[report.printState] ?? 'UNKNOWN'};
    if (Number.isFinite(report.progressPercent)) proof.progressPercent = report.progressPercent;
    return {...candidate,connectionState:'online',probeEvidence:proof};
  } catch (error) {
    const authProblem = ['BAMBU_AUTH_REQUIRED','BAMBU_TRUST_REQUIRED','BAMBU_CERTIFICATE_MISMATCH'].includes(error?.code);
    return {...candidate,connectionState:authProblem ? 'authorization_required' : 'offline'};
  }
}
