const assert = require('assert').strict;
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(__dirname + '/main.js', 'utf8');
const definitions = source.slice(0, source.lastIndexOf('try { main(); }'));
function environment() {
  const events = [];
  let tick = 0;
  const modes = {};
  const gpio = {pinMode(pin, mode) { modes[pin] = mode; }, digitalRead() { return 1; }};
  const ble = {
    rawAdv(hex, ms) { events.push({type:'send', hex, ms, time:tick}); return true; },
    rawAdvStop() { events.push({type:'stop', time:tick}); }
  };
  const display = {width:()=>160, height:()=>128, color:()=>0};
  for (const method of ['drawFillRect','setTextSize','setTextAlign','setTextColor','fill']) display[method] = ()=>{};
  display.drawString = (text,x,y)=>events.push({type:'text',text,x,y,time:tick});
  const ctx = {require(name) { return {gpio,ble,display,keyboard:{},dialog:{error:()=>{}},storage:{}}[name]; },
    __dirpath:'/BruceJS/lerc_remote', INPUT:1, INPUT_PULLUP:5, now:()=>tick,
    delay(ms) { tick += ms; if(tick > 3000) throw Error('simulation timeout'); },
    console:{log(text){events.push({type:'log',text,time:tick});}}};
  vm.createContext(ctx); vm.runInContext(definitions, ctx);
  return {ctx,events,gpio,ble,modes, get time(){return tick;}};
}

const e = environment(), c = e.ctx;
const config = JSON.parse(fs.readFileSync(__dirname+'/packets.json'));
c.validateConfig(config);
assert.throws(()=>c.hexBytes('0G'));
assert.throws(()=>c.hexBytes('ABC'));
assert.throws(()=>c.oneByte(256,0));
assert.throws(()=>c.oneByte('0102',0));
for (const patch of [{params:'AA'.repeat(10)},{params:12},{cmd:'QZ'},{targets:['1234']},{targets:[]},{intervalMs:0},{advIntervalMs:19},{onRelease:'0A'},{onRelease:{cmd:'0A',params:'AA'.repeat(10)}}]) {
  assert.throws(()=>c.preparePacket(config, {...config.packets[0], ...patch}));
}
assert.throws(()=>c.validateConfig({packets:[]}));
assert.equal(c.buildAdv('6012BAF1',254,0,186,254,[1,170,170]).length,21);
assert.equal(c.bytesToHex(c.buildAdv('6012BAF1',254,0,186,254,[1,170,170])),
  '14FFFFFFFFFF0E01F1BA1260946AD094696BC0C0B9');
assert.equal(c.bytesToHex(c.buildAdv('0AD3C5AB',254,0,1,0,[1,170,170,0,0])),
  '16FFFFFFFFFF1001ABC5D30A7B85848580842F2F8585DD');
for(let len=0;len<=9;len++) {
  const ad=c.buildAdv('0AD3C5AB',254,0,1,0,Array(len).fill(0));
  assert.equal(ad[0],ad.length-1);assert.equal(ad[6],11+len);
}

const smallConfig={targets:['6012BAF1','FFFFFFFF'],startPackId:254,intervalMs:100,advIntervalMs:20,
  packets:[{name:'One',cmd:'0A',params:''},{name:'Two',cmd:'00',params:'01AAAA0000'}]};
function setKeys(env, spans) {
  env.gpio.digitalRead = pin => (spans[pin]||[]).some(([a,b])=>env.time>=a&&env.time<b)?0:1;
}
const direct=environment();
setKeys(direct,{34:[[0,40],[300,650]],2:[[80,130]],13:[[180,230]],12:[[900,2000]]});
assert.equal(direct.ctx.runList(smallConfig),0); // UP wraps to Reload, DOWN returns to first.
const tx=direct.events.filter(x=>x.type==='send');
assert.deepEqual(tx.map(x=>x.time),[320,420,520,620]);
assert.equal(tx[0].hex.slice(14,24),'01F1BA1260');
assert.equal(tx[1].hex.slice(14,24),'01FFFFFFFF');
assert(tx.every(x=>x.ms===20));
assert.equal(direct.ctx.PACK_ID,2); // FE -> FF -> 00 -> 01, next 02.
assert(direct.events.some(x=>x.type==='stop'&&x.time===650));
for(const pin of [2,13,12,27]) assert.equal(direct.modes[pin],direct.ctx.INPUT_PULLUP);
for(const pin of [34,35]) assert.equal(direct.modes[pin],direct.ctx.INPUT);
assert(direct.events.filter(x=>x.type==='text').every(x=>x.y>=0&&x.y+8<=128));
for(let total of [2,6,30]) {
  assert.equal(c.moveSelection(0,-1,total),total-1);
  assert.equal(c.moveSelection(total-1,1,total),0);
  assert(c.moveSelection(0,-5,total)>=0);
}
const bounce=environment();
setKeys(bounce,{2:[[50,55]],12:[[200,2000]]});
assert.equal(bounce.ctx.runList(smallConfig),0);
assert.equal(bounce.events.filter(x=>x.type==='send').length,0);
const repeat=environment();
setKeys(repeat,{13:[[100,800]],12:[[1000,2000]]});
assert.equal(repeat.ctx.runList(smallConfig),0); // 120, 570, 720 = three moves.
const error=environment();
setKeys(error,{34:[[100,350],[500,750]],12:[[900,2000]]});
error.ble.rawAdv=()=>{error.events.push({type:'send',time:error.time});throw Error('radio fault');};
error.ctx.runList(smallConfig);
assert.equal(error.events.filter(x=>x.type==='send').length,2); // Retry only on a new press.
assert.equal(error.events[error.events.length-1].type,'stop');
const cancel=environment();
setKeys(cancel,{34:[[0,1000]],12:[[100,2000]]});
cancel.ctx.runList(smallConfig);
assert.equal(cancel.events.filter(x=>x.type==='send').length,0); // Held launch button cannot TX.

function decoded(event) {
  const ad=Buffer.from(event.hex,'hex');
  const frame=Array.from(ad.slice(7));
  const key=c.V1_KEYS[frame[1]&15];
  for(let i=5;i<frame.length;i++) frame[i]^=key;
  assert.equal(frame.reduce((a,b)=>a+b,0)&255,255);
  return {cmd:frame[8],id:frame[7],params:frame.slice(10,-1),target:ad.slice(8,12).toString('hex')};
}
for(const cmd of ['02','03','04','05']) {
  const adjust=environment();
  setKeys(adjust,{34:[[100,350]],12:[[750,2000]]});
  adjust.ctx.runList({targets:['0AD3C5AB'],startPackId:1,packets:[{name:'Adjust',cmd,params:''}]});
  const sent=adjust.events.filter(x=>x.type==='send').map(decoded);
  assert.deepEqual(sent.map(x=>x.cmd),[parseInt(cmd,16),parseInt(cmd,16),parseInt(cmd,16),10]);
  assert.deepEqual(sent.map(x=>x.id),[1,2,3,4]);
  assert.deepEqual(sent[3].params,[]);
}
const multi=environment();
setKeys(multi,{34:[[100,350]],12:[[900,2000]]});
multi.ctx.runList({...smallConfig,packets:[{name:'Dim',cmd:'02',params:''}]});
const multiTx=multi.events.filter(x=>x.type==='send').map(decoded);
assert.deepEqual(multiTx.map(x=>x.cmd),[2,2,2,10,10]);
assert.deepEqual(multiTx.map(x=>x.id),[254,255,0,1,2]);
assert.equal(multiTx[3].target,multiTx[0].target);
assert.equal(multiTx[4].target,multiTx[1].target);
assert.equal(multi.ctx.PACK_ID,3);
const back=environment();
setKeys(back,{34:[[100,2000]],12:[[350,2000]]});
back.ctx.runList({targets:['0AD3C5AB'],packets:[{cmd:'04',params:''}]});
assert.equal(decoded(back.events.filter(x=>x.type==='send').slice(-1)[0]).cmd,10);
const failedRelease=environment();
setKeys(failedRelease,{34:[[100,350]],12:[[750,2000]]});
failedRelease.ble.rawAdv=(hex,ms)=>{
  const event={type:'send',hex,ms,time:failedRelease.time};failedRelease.events.push(event);
  if(decoded(event).cmd===10) throw Error('release radio fault');return true;
};
failedRelease.ctx.runList({targets:['0AD3C5AB'],packets:[{cmd:'03',params:''}]});
assert.equal(failedRelease.events.filter(x=>x.type==='send'&&decoded(x).cmd===10).length,1);
assert(failedRelease.events.some(x=>x.type==='log'&&x.text.indexOf('LERC_RELEASE_ERROR')===0));
assert.equal(failedRelease.events[failedRelease.events.length-1].type,'stop');
assert(!config.packets.some(x=>x.name==='Dimming STOP'));

// Emit a matrix for a Python differential check against the supplied source.
const vectors=[];
for(let key=0;key<16;key++) for(const id of [0,1,186,255]) for(const len of [0,1,3,9]) {
  const target='123456'+key.toString(16).padStart(2,'0');
  const params=Array.from({length:len},(_,i)=>(i*37+key)&255);
  vectors.push({target,id,cmd:254,params,hex:c.bytesToHex(c.buildAdv(target,254,0,id,254,params))});
}
if(process.argv.includes('--vectors')) console.log(JSON.stringify(vectors));
else console.log('PASS: automatic adjustment STOP on release/back, multi-target IDs, release errors, captured ON packet, direct list keys and 256 codec vectors');
