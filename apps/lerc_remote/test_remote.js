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
  for (const method of ['drawFillRect','setTextSize','setTextAlign','setTextColor','drawString','fill']) display[method] = ()=>{};
  const ctx = {require(name) { return {gpio,ble,display,keyboard:{},dialog:{error:()=>{}},storage:{}}[name]; },
    __dirpath:'/BruceJS/lerc_remote', INPUT:1, INPUT_PULLUP:5, now:()=>tick,
    delay(ms) { tick += ms; if(tick > 1000) throw Error('simulation timeout'); }, console};
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
for (const patch of [{params:'AA'.repeat(10)},{params:12},{cmd:'QZ'},{targets:['1234']},{targets:[]},{intervalMs:0},{advIntervalMs:19}]) {
  assert.throws(()=>c.preparePacket(config, {...config.packets[0], ...patch}));
}
assert.throws(()=>c.validateConfig({packets:[]}));
assert.equal(c.buildAdv('6012BAF1',254,0,186,254,[1,170,170]).length,21);
assert.equal(c.bytesToHex(c.buildAdv('6012BAF1',254,0,186,254,[1,170,170])),
  '14FFFFFFFFFF0E01F1BA1260946AD094696BC0C0B9');

function simulation(injectError) {
  const env = environment();
  // A initially held from selecting the menu item; release at 40ms, press at
  // 100ms, release at 350ms. B returns at 420ms.
  env.gpio.digitalRead = pin => pin === 12 ? (env.time >= 420 ? 0:1) :
    (env.time < 40 || (env.time >= 100 && env.time < 350) ? 0:1);
  if(injectError) env.ble.rawAdv = ()=>{env.events.push({type:'send',time:env.time}); throw Error('radio fault');};
  const cfg={targets:['6012BAF1','FFFFFFFF'],startPackId:254,intervalMs:100,advIntervalMs:20};
  const pkt={name:'Test',cmd:'0A',params:''};
  if(injectError) assert.throws(()=>env.ctx.runPacket(cfg,pkt),/radio fault/);
  else env.ctx.runPacket(cfg,pkt);
  assert.equal(env.modes[34],env.ctx.INPUT); // GPIO34 has an external pull-up.
  assert.equal(env.modes[12],env.ctx.INPUT_PULLUP); // B must not float low.
  assert.equal(env.events[env.events.length-1].type,'stop');
  if(!injectError) {
    const tx=env.events.filter(x=>x.type==='send');
    assert.deepEqual(tx.map(x=>x.time),[100,200,300]);
    assert(tx.every(x=>x.ms===20));
    assert.equal(env.ctx.PACK_ID,1); // FE -> FF -> 00, next is 01
    assert(env.events.some(x=>x.type==='stop' && x.time===350));
    assert.equal(tx[0].hex.slice(14,24),'01F1BA1260');
    assert.equal(tx[1].hex.slice(14,24),'01FFFFFFFF');
    env.ctx.initPackId({startPackId:12}); assert.equal(env.ctx.PACK_ID,1);
  }
}
simulation(false); simulation(true);
const idle=environment();
idle.gpio.digitalRead=pin=>pin===12 && idle.time>=10?0:0;
idle.ctx.runPacket({targets:['6012BAF1']},{cmd:'0A',params:''});
assert.equal(idle.events.filter(x=>x.type==='send').length,0);

// Emit a matrix for a Python differential check against the supplied source.
const vectors=[];
for(let key=0;key<16;key++) for(const id of [0,1,186,255]) for(const len of [0,1,3,9]) {
  const target='123456'+key.toString(16).padStart(2,'0');
  const params=Array.from({length:len},(_,i)=>(i*37+key)&255);
  vectors.push({target,id,cmd:254,params,hex:c.bytesToHex(c.buildAdv(target,254,0,id,254,params))});
}
if(process.argv.includes('--vectors')) console.log(JSON.stringify(vectors));
else console.log('PASS: config validation, release-to-arm, targets, packet IDs, release/back/error cleanup; 256 codec vectors');
