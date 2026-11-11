import fs from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import project from '../package.json' with { type:'json' };

// This fixed distribution list is independent of the contents of the user's
// installation. In particular it cannot include a pairing, access code or DB.
const files = [
  'BAMBU-GATEWAY-WINDOWS.cmd', 'tools/bambu-gateway.mjs',
  ...['cli.mjs','client.mjs','config.mjs','coverage.mjs','discovery.mjs','mdns.mjs',
    'bambu-discovery.mjs','bambu-status.mjs','bambu-printer-ca.cer'].map(name=>'services/device-gateway/'+name),
];

const readme = `共造 · Windows 拓竹农场网关

1. 选择一台与打印机在同一局域网的 Windows 电脑，安装 Node.js 24 或更新版本。
2. 将此 ZIP 全部解压到一个文件夹。商家在共造设备页连接网关，单独下载属于自己的 gateway.private.json 配对文件。
3. 双击 BAMBU-GATEWAY-WINDOWS.cmd，在提示处拖入刚下载的配对文件，核对它显示的平台地址。
4. 需要整机打印状态时，在向导中为对应打印机录入局域网访问码，然后试读状态。访问码保存在这台电脑上。
5. 选择「启动网关」并保持窗口开启，再到商家设备页检测和添加设备。固件的本地授权和当前网络会影响识别结果。

此工具提供设备发现和只读状态采样。设备忙闲以新收到的状态报告为准。
本机凭据及商家配对文件均不随此包分发。请将自己的配对文件妥善保存。
`;

// Standard single-disk ZIP, method 8 (raw deflate). Stable metadata make the
// archive reproducible from the same sources. Only the small fixed kit is read.
function zip(entries) {
  const local = [], central = [];
  let localSize = 0;
  for (const [name,bytes] of entries) {
    const filename = Buffer.from(name);
    const compressed = deflateRawSync(bytes);
    const file = Buffer.alloc(30);
    file.writeUInt32LE(0x04034b50,0);
    file.writeUInt16LE(20,4);
    file.writeUInt16LE(0x800,6); // UTF-8 names
    file.writeUInt16LE(8,8);
    file.writeUInt16LE(0x21,12); // 1980-01-01
    file.writeUInt32LE(crc32(bytes),14);
    file.writeUInt32LE(compressed.length,18);
    file.writeUInt32LE(bytes.length,22);
    file.writeUInt16LE(filename.length,26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50,0);
    directory.writeUInt16LE(20,4);
    file.copy(directory,6,4,30);
    directory.writeUInt32LE(localSize,42);
    local.push(file,filename,compressed);
    central.push(directory,filename);
    localSize += file.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(entries.length,8);
  end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(directory.length,12);
  end.writeUInt32LE(localSize,16);
  return Buffer.concat([...local,directory,end]);
}

export async function buildBambuGatewayKit() {
  const root = await fs.realpath(path.join(import.meta.dirname,'..'));
  const entries = await Promise.all(files.map(async name=>{
    const file = path.join(root,name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 512 * 1024 || await fs.realpath(file) !== file)
      throw new Error('Unexpected gateway distribution file: '+name);
    return [name,await fs.readFile(file)];
  }));
  const manifest = {name:'gongzao-bambu-gateway',version:project.version,private:true,type:'module',engines:{node:'>=24'}};
  entries.push(['package.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n')],
    ['README.txt',Buffer.from('\uFEFF'+readme.replaceAll('\n','\r\n'))]);
  return zip(entries);
}
