"""Install/update the remote in LittleFS over Bruce USB CLI (no TF card needed)."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import time

import serial

ROOT = Path(__file__).resolve().parent
DEVICE_DIR = '/BruceJS/lerc_remote'


class Device:
    def __init__(self, port):
        self.port = serial.Serial(port=None, baudrate=115200, timeout=.1)
        self.port.dtr = False
        self.port.rts = False
        self.port.port = port
        self.port.open()
        self.transcript = bytearray()
        self.receive(.4)

    def receive(self, seconds, marker=None):
        data = bytearray()
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            data.extend(self.port.read(self.port.in_waiting or 1))
            normalized = bytes(data).replace(b'\r', b'')
            if marker and marker in normalized:
                break
        self.transcript.extend(data)
        return bytes(data).replace(b'\r', b'')

    def command(self, text, timeout=8):
        self.port.write((text+'\n').encode())
        answer = self.receive(timeout, b'\n# ')
        if b'\n# ' not in answer:
            raise RuntimeError('No CLI response: '+text)
        return answer

    def run_js(self, code, marker):
        self.port.write(('js run_from_buffer '+str(len(code.encode())+128)+'\n').encode())
        answer = self.receive(5, b'until EOF')
        if b'until EOF' not in answer:
            raise RuntimeError('Interpreter upload handshake failed')
        for start in range(0,len(code.encode()),256):
            self.port.write(code.encode()[start:start+256])
            time.sleep(.01)
        self.port.write(b'\nEOF\n')
        answer = self.receive(8, marker.encode())
        answer += self.receive(.6)
        if marker.encode() not in answer:
            raise RuntimeError('Interpreter probe failed: '+answer.decode('utf-8','replace'))
        return answer

    def read_file(self, path):
        # CLI md5/read use readSmallFile and block on files over its limit.
        # Read binary through BJS instead, then hash the exact bytes on the PC.
        code = """var s=require('storage');var data=null;
try{data=s.read({fs:'littlefs',path:%s},true);}catch(readError){}
if(data===null){console.log('REMOTE_FILE_MISSING');}
else{var digits='0123456789abcdef';var line='';
for(var i=0;i<data.length;i++){line+=digits.charAt(data[i]>>4)+digits.charAt(data[i]&15);
if(line.length===256){console.log('REMOTE_BYTES='+line);line='';delay(5);}}
if(line.length)console.log('REMOTE_BYTES='+line);
console.log('REMOTE_FILE_SIZE='+data.length);}
console.log('REMOTE_READ_DONE');""" % json.dumps(path)
        answer = self.run_js(code,'REMOTE_READ_DONE')
        if b'REMOTE_FILE_MISSING' in answer:
            return None
        matches = re.findall(rb'(?m)^REMOTE_BYTES=([0-9a-f]+)$',answer)
        data = bytes.fromhex(b''.join(matches).decode())
        size = re.search(rb'REMOTE_FILE_SIZE=(\d+)',answer)
        if not size or len(data) != int(size.group(1)):
            raise RuntimeError('Incomplete file readback: '+path)
        return data

    def md5(self, path):
        data = self.read_file(path)
        return hashlib.md5(data).hexdigest() if data is not None else None

    def install_file(self, source, target, backup_dir):
        content = source.read_text(encoding='utf-8-sig').replace('\r\n','\n')
        if not content.endswith('\n'):
            content += '\n'
        data = content.encode('utf-8')
        expected = hashlib.md5(data).hexdigest()
        old_md5 = self.md5(target)
        if old_md5 == expected:
            print('Already current:',target,flush=True)
            return expected
        if old_md5:
            old_data = self.read_file(target)
            if hashlib.md5(old_data).hexdigest() != old_md5:
                raise RuntimeError('Cannot verify backup of '+target)
            (backup_dir/source.name).write_bytes(old_data)
        temporary = target+'.tmp'
        self.port.write(('storage write '+temporary+' '+str(len(data)+128)+'\n').encode())
        answer = self.receive(5, b'until EOF')
        if b'until EOF' not in answer:
            raise RuntimeError('Storage upload handshake failed')
        # The CLI reads newline-delimited UTF-8. Keep writes below the RX buffer.
        for line in data.splitlines(keepends=True):
            if line.rstrip(b'\n') == b'EOF':
                raise ValueError('A literal EOF line cannot be uploaded by this CLI')
            for start in range(0,len(line),256):
                self.port.write(line[start:start+256])
                time.sleep(.008)
        self.port.write(b'EOF\n')
        answer = self.receive(8,b'\n# ')
        if b'File written:' not in answer or self.md5(temporary) != expected:
            raise RuntimeError('Upload hash mismatch: '+target)
        # Keep the previous file on-device until the verified replacement exists.
        previous = target+'.previous'
        if old_md5:
            if self.md5(previous):
                self.command('storage remove '+previous)
            self.command('storage rename '+target+' '+previous)
        self.command('storage rename '+temporary+' '+target)
        if self.md5(target) != expected:
            if old_md5:
                self.command('storage rename '+previous+' '+target)
            raise RuntimeError('Final file verification failed: '+target)
        if old_md5:
            self.command('storage remove '+previous)
        print('Installed:',target,'MD5='+expected,flush=True)
        return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',default='COM14')
    parser.add_argument('--config',type=Path,default=ROOT/'packets.json')
    parser.add_argument('--config-only',action='store_true')
    parser.add_argument('--launch',action='store_true',help='Open the idle remote menu; does not transmit')
    args = parser.parse_args()
    cfg = json.loads(args.config.read_text(encoding='utf-8-sig'))
    if not isinstance(cfg.get('packets'),list) or not cfg['packets']:
        raise ValueError('The config needs a nonempty packets list')
    backup_dir = ROOT/'output'/datetime.now().strftime('%Y%m%d-%H%M%S')
    backup_dir.mkdir(parents=True,exist_ok=True)
    device = Device(args.port)
    try:
        device.command('js exit')
        time.sleep(.5)
        probe = '''var b=require('ble');var s=require('storage');var sd=false;
try{s.readdir({fs:'sd',path:'/'});sd=true;}catch(e){}
console.log('REMOTE_CAPS='+typeof b.rawAdv+','+typeof b.rawAdvStop+',SD='+sd);
console.log('REMOTE_PROBE_DONE');'''
        answer = device.run_js(probe,'REMOTE_PROBE_DONE')
        if b'REMOTE_CAPS=function,function,SD=false' not in answer:
            raise RuntimeError('Needs firmware with rawAdv/rawAdvStop and no mounted TF card: '+answer.decode('utf-8','replace'))
        device.command('storage mkdir /BruceJS')
        device.command('storage mkdir '+DEVICE_DIR)
        files = [] if args.config_only else [(ROOT/'main.js',DEVICE_DIR+'/main.js')]
        files.append((args.config, DEVICE_DIR+'/packets.json'))
        results = {target:device.install_file(source,target,backup_dir) for source,target in files}
        code="var s=require('storage');var c=JSON.parse(s.read({fs:'littlefs',path:'"+DEVICE_DIR+"/packets.json'}));console.log('REMOTE_CONFIG='+c.packets.length);console.log('REMOTE_STORAGE_VERIFIED');"
        answer=device.run_js(code,'REMOTE_STORAGE_VERIFIED')
        assert ('REMOTE_CONFIG='+str(len(cfg['packets']))).encode() in answer
        if args.launch:
            answer = device.command('js '+DEVICE_DIR+'/main.js')
            if b'LERC_READY' not in answer:
                answer += device.receive(8,b'fs=littlefs')
            if b'LERC_READY' not in answer:
                raise RuntimeError('Installed files verified, but remote menu failed to start: '+answer.decode('utf-8','replace'))
        report={'port':args.port,'path':DEVICE_DIR,'files_md5':results,
                'packet_count':len(cfg['packets']),'littlefs_verified':True,'transmitted':False}
        (backup_dir/'installation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps(report,indent=2))
        print('Saved report:',backup_dir,flush=True)
    finally:
        (backup_dir/'serial.log').write_bytes(device.transcript)
        device.port.close()


if __name__=='__main__':
    main()
