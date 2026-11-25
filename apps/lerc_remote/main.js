/*
 * 乐式 RF 遥控包发射器 —— Bruce BJS 扩展应用（不需要插 SD 卡）
 *
 * 放到设备 LittleFS：/BruceJS/lerc_remote/main.js
 * 同目录放 packets.json 定义自己的包列表（格式见 README.md）
 * 菜单路径：主菜单 -> Scripts -> lerc_remote -> main
 *
 * 帧格式（乐式 V1 遥控器帧，见《乐式 RF 数据包格式定义说明》）：
 *   01 | RemoteID(4, 小端) | RType(FE) | LampID | PackId | Cmd | Plen | Params | CRC
 *   前 5 字节明文，第 5 字节起（RType..CRC）用 V1 密钥异或。
 *   广播载荷：FF FF FF FF + 帧长 + 帧，外面套 AD 长度与 AD 类型(FF)。
 */

var display = require('display');
var dialog = require('dialog');
var gpio = require('gpio');
var ble = require('ble');
var storage = require('storage');

var DIR = (typeof __dirpath === 'string' && __dirpath.length > 0) ? __dirpath : '/BruceJS/lerc_remote';
var CONFIG_PATH = DIR + '/packets.json';

var W = display.width();
var H = display.height();

var KEY_A = 34; // A 键，按住连发
var KEY_B = 12; // B 键，返回
var KEY_UP = 2;
var KEY_DOWN = 13;
var KEY_LEFT = 27;
var KEY_RIGHT = 35;

var C_BG = display.color(0, 0, 0);
var C_FG = display.color(255, 255, 255);
var C_ACC = display.color(0, 220, 120);
var C_DIM = display.color(150, 150, 150);
var C_WARN = display.color(255, 80, 80);

// ======================= CODEC BEGIN =======================
// 纯计算部分，不依赖任何 Bruce 接口，方便在 PC 上对照验证。

var V1_KEYS = [
  0xCB, 0x6A, 0x95, 0x8D, 0xB6, 0x7B, 0x35, 0x5A,
  0x6E, 0x49, 0x5C, 0x85, 0x37, 0x3C, 0xA6, 0x88
];
var HEX_CHARS = "0123456789ABCDEF";
var ADV_PREFIX = [0xFF, 0xFF, 0xFF, 0xFF];

function hexClean(s) {
  var out = "";
  var i, ch;
  if (s === null || s === undefined) return out;
  s = String(s);
  for (i = 0; i < s.length; i++) {
    ch = s.charAt(i);
    if (HEX_CHARS.indexOf(ch) >= 0 || "abcdef".indexOf(ch) >= 0) out += ch;
    else if (" \t\r\n:-".indexOf(ch) < 0) throw new Error("Invalid hex: " + s);
  }
  if (out.length % 2 !== 0) throw new Error("Odd hex length: " + s);
  return out;
}

function hexBytes(s) {
  var clean = hexClean(s);
  var out = [];
  var i, v;
  for (i = 0; i + 1 < clean.length; i += 2) {
    v = parseInt(clean.substring(i, i + 2), 16);
    if (!isNaN(v)) out.push(v & 0xFF);
  }
  return out;
}

function bytesToHex(arr, sep) {
  var s = "";
  var i;
  if (sep === undefined) sep = "";
  for (i = 0; i < arr.length; i++) {
    if (i > 0 && sep !== "") s += sep;
    s += HEX_CHARS.charAt((arr[i] >> 4) & 0x0F) + HEX_CHARS.charAt(arr[i] & 0x0F);
  }
  return s;
}

function oneByte(s, dflt) {
  if (typeof s === "number") {
    if (!isFinite(s) || s !== Math.floor(s) || s < 0 || s > 255) throw new Error("Byte outside 0..255");
    return s;
  }
  var b = hexBytes(s);
  if (b.length === 0) return dflt;
  if (b.length !== 1) throw new Error("Expected one byte: " + s);
  return b[0];
}

/* 组一帧遥控包并加上广播头，返回完整 AD 数据（数组）。
 * targetId 形如 "6012BAF1"（同上位机/上位软件里显示的遥控器 ID）。 */
function buildAdv(targetId, deviceType, group, packId, cmd, params) {
  var id = hexBytes(targetId);
  if (id.length !== 4) return null;

  // 包内按小端存放：6012BAF1 -> F1 BA 12 60
  var wire = [id[3], id[2], id[1], id[0]];

  if (params.length > 9) return null; // 协议里 Plen 最大 9

  var frame = [0x01, wire[0], wire[1], wire[2], wire[3], deviceType & 0xFF,
               group & 0xFF, packId & 0xFF, cmd & 0xFF, params.length];
  var i;
  for (i = 0; i < params.length; i++) frame.push(params[i] & 0xFF);

  var sum = 0;
  for (i = 0; i < frame.length; i++) sum = (sum + frame[i]) & 0xFF;
  frame.push((~sum) & 0xFF);

  // 第 5 字节（RType）开始异或，密钥下标取包内地址首字节的低 4 位
  var key = V1_KEYS[wire[0] & 0x0F];
  for (i = 5; i < frame.length; i++) frame[i] = (frame[i] ^ key) & 0xFF;

  var adv = [frame.length + ADV_PREFIX.length + 2, 0xFF];
  for (i = 0; i < ADV_PREFIX.length; i++) adv.push(ADV_PREFIX[i]);
  adv.push(frame.length);
  for (i = 0; i < frame.length; i++) adv.push(frame[i]);
  return adv;
}
// ======================== CODEC END ========================

function cfgGet(obj, key, dflt) {
  if (obj === null || obj === undefined) return dflt;
  if (obj[key] === undefined || obj[key] === null) return dflt;
  return obj[key];
}

function loadConfig() {
  var raw = null;
  try {
    raw = storage.read({fs: 'littlefs', path: CONFIG_PATH});
  } catch (e) {
    raw = null;
  }
  if (raw === null || raw === undefined || raw.length < 4) return null;
  var cfg = null;
  try {
    cfg = JSON.parse(raw);
  } catch (e2) {
    cfg = null;
  }
  return cfg;
}

function fit(s, size) {
  var maxChars = Math.floor((W - 4) / (6 * (size === undefined ? 1 : size)));
  s = String(s);
  if (s.length <= maxChars) return s;
  return s.substring(0, maxChars - 1) + "~";
}

function row(y, text, color, size) {
  if (size === undefined) size = 1;
  display.drawFillRect(0, y, W, 8 * size + 2, C_BG);
  display.setTextSize(size);
  display.setTextAlign('left', 'top');
  display.setTextColor(color);
  display.drawString(fit(text, size), 2, y);
}

function asList(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return [v];
  if (!Array.isArray(v) || v.length === 0) throw new Error("targets must be a nonempty list");
  return v;
}

function targetsOf(cfg, pkt) {
  var list = asList(cfgGet(pkt, "targets", null));
  if (list !== null) return list;
  var single = cfgGet(pkt, "remoteId", null);
  if (single !== null) return [single];
  list = asList(cfgGet(cfg, "targets", null));
  if (list !== null) return list;
  single = cfgGet(cfg, "remoteId", null);
  if (single !== null) return [single];
  return [];
}

function preparePacket(cfg, pkt) {
  if (!pkt || typeof pkt !== 'object' || Array.isArray(pkt)) throw new Error("Packet must be an object");
  var targets = targetsOf(cfg, pkt);
  if (targets.length === 0) throw new Error("Missing targets/remoteId");
  for (var i = 0; i < targets.length; i++) {
    if (typeof targets[i] !== 'string' || hexBytes(targets[i]).length !== 4) throw new Error("ID must be 4 bytes");
  }
  var interval = Number(cfgGet(pkt, 'intervalMs', cfgGet(cfg, 'intervalMs', 100)));
  var advInterval = Number(cfgGet(pkt, 'advIntervalMs', cfgGet(cfg, 'advIntervalMs', 20)));
  if (!isFinite(interval) || interval < 20 || interval > 60000 || interval !== Math.floor(interval)) throw new Error("intervalMs: 20..60000");
  if (!isFinite(advInterval) || advInterval < 20 || advInterval > 10240 || advInterval !== Math.floor(advInterval)) throw new Error("advIntervalMs: 20..10240");
  var paramText = cfgGet(pkt, 'params', '');
  if (typeof paramText !== 'string') throw new Error("params must be hex text");
  var params = hexBytes(paramText);
  if (params.length > 9) throw new Error("Params: at most 9 bytes");
  if (pkt.cmd === undefined || pkt.cmd === null || pkt.cmd === '') throw new Error("Missing cmd");
  var cmd = oneByte(pkt.cmd, 0);
  var release = cfgGet(pkt, 'onRelease', cmd >= 2 && cmd <= 5 ? {cmd: '0A', params: ''} : null);
  if (release !== null) {
    if (typeof release !== 'object' || Array.isArray(release) || release.cmd === undefined) throw new Error('Invalid onRelease');
    if (typeof cfgGet(release, 'params', '') !== 'string') throw new Error('onRelease.params must be hex text');
    var releaseParams = hexBytes(cfgGet(release, 'params', ''));
    if (releaseParams.length > 9) throw new Error('onRelease.params: at most 9 bytes');
    release = {cmd: oneByte(release.cmd, 0), params: releaseParams};
  }
  return {
    targets: targets, interval: interval, advInterval: advInterval, params: params,
    deviceType: oneByte(cfgGet(pkt, 'deviceType', cfgGet(cfg, 'deviceType', 'FE')), 0xFE),
    group: oneByte(cfgGet(pkt, 'group', cfgGet(cfg, 'group', '00')), 0),
    cmd: cmd, name: String(cfgGet(pkt, 'name', 'Packet')), onRelease: release
  };
}

function validateConfig(cfg) {
  if (!cfg || !Array.isArray(cfg.packets) || cfg.packets.length === 0) throw new Error("Empty packets list");
  if (cfg.startPackId !== undefined) oneByte(cfg.startPackId, 0);
  for (var i = 0; i < cfg.packets.length; i++) {
    try { preparePacket(cfg, cfg.packets[i]); }
    catch (e) { throw new Error("Packet " + (i + 1) + ": " + e.message); }
  }
}

/* 帧里的包序号（PackId）。真遥控器是整机一个计数器：每发一包 +1，且不因为
 * 换了按键/重进菜单就回到起点。这里用模块级变量保存，脚本运行期间一直递增，
 * 只有退出脚本（重新进 main）才会重置。 */
var PACK_ID = -1;

function initPackId(cfg) {
  if (PACK_ID >= 0) return;
  var v = oneByte(cfgGet(cfg, "startPackId", now() & 0xFF), 0);
  PACK_ID = v & 0xFF;
}

// Finish each addressed adjustment with a real remote STOP frame, then stop BLE.
// Only targets that received a successful adjustment need a release frame.
function sendRelease(pending) {
  if (pending === null) return true;
  var packet = pending.packet;
  var ok = true;
  for (var r = 0; r < pending.targets.length; r++) {
    try {
      var ad = buildAdv(pending.targets[r], packet.deviceType, packet.group, PACK_ID,
                        packet.onRelease.cmd, packet.onRelease.params);
      var hex = bytesToHex(ad);
      // A short burst at 20ms gives the receiver time to hear the release.
      if (!ble.rawAdv(hex, 20)) throw new Error('Release BLE start failed');
      console.log('LERC_RELEASE pid=' + PACK_ID + ' ad=' + hex);
      PACK_ID = (PACK_ID + 1) & 0xFF;
      delay(100);
    } catch (releaseError) {
      ok = false;
      console.log('LERC_RELEASE_ERROR ' + releaseError.message);
    } finally {
      ble.rawAdvStop();
    }
  }
  return ok;
}

// Debounce physical keys without consuming Bruce's shared menu key flags.
function readButton(state, pin, time) {
  var raw = gpio.digitalRead(pin) === 0;
  if (raw !== state.raw) { state.raw = raw; state.changed = time; }
  var pressed = false;
  if (raw !== state.down && time - state.changed >= 20) {
    state.down = raw;
    pressed = raw;
  }
  return pressed;
}

function moveSelection(index, delta, total) {
  return ((index + delta) % total + total) % total;
}

function drawList(cfg, index) {
  var packets = cfg.packets;
  var total = packets.length + 1; // Last item reloads the editable JSON.
  var page = Math.floor(index / 5) * 5;
  display.fill(C_BG);
  row(0, 'LERC REMOTE ' + (index + 1) + '/' + total, C_ACC);
  if (index < packets.length) {
    var p = preparePacket(cfg, packets[index]);
    row(14, 'ID ' + p.targets[0] + ' G' + bytesToHex([p.group]), C_DIM);
    row(90, bytesToHex([p.cmd]) + ': ' + (p.params.length ? bytesToHex(p.params, ' ') : '-'), C_FG);
  } else {
    row(14, 'Reload from LittleFS', C_DIM);
  }
  for (var i = 0; i < 5 && page + i < total; i++) {
    var n = page + i;
    var label = n === packets.length ? 'Reload packets.json' : (n + 1) + '. ' + String(packets[n].name);
    row(28 + i * 12, (n === index ? '> ' : '  ') + label, n === index ? C_ACC : C_FG);
  }
  row(104, 'READY - hold A to TX', C_ACC);
  row(116, 'UP/DN  A:TX  B:EXIT', C_DIM);
}

function runList(cfg) {
  gpio.pinMode(KEY_A, INPUT);
  gpio.pinMode(KEY_B, INPUT_PULLUP);
  gpio.pinMode(KEY_UP, INPUT_PULLUP);
  gpio.pinMode(KEY_DOWN, INPUT_PULLUP);
  gpio.pinMode(KEY_LEFT, INPUT_PULLUP);
  gpio.pinMode(KEY_RIGHT, INPUT);
  var pins = [KEY_A, KEY_B, KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT];
  var keys = [];
  var start = now();
  for (var k = 0; k < pins.length; k++) {
    var held = gpio.digitalRead(pins[k]) === 0;
    keys.push({raw: held, down: held, changed: start, repeatAt: start + 450});
  }
  // Opening the app with A held must not transmit until it is released.
  var armed = !keys[0].down;
  var index = 0, sent = 0, targetIndex = 0;
  var advertising = false, fault = false, lastSend = -1000000;
  var pending = null;
  initPackId(cfg);
  drawList(cfg, index);
  console.log('LERC_READY packets=' + cfg.packets.length + ' fs=littlefs');
  try {
    while (true) {
      var time = now();
      var edges = [];
      for (var j = 0; j < pins.length; j++) edges.push(readButton(keys[j], pins[j], time));
      if (keys[1].down) break;
      if (!keys[0].raw) {
        if (!keys[0].down) { armed = true; fault = false; }
        if (advertising || pending !== null) {
          ble.rawAdvStop(); advertising = false;
          var ending = pending; pending = null;
          armed = false;
          var released = sendRelease(ending);
          row(104, released ? 'SENT ' + sent + ' STOPPED' : 'RELEASE ERROR', released ? C_DIM : C_WARN);
        }
      }
      if (!keys[0].raw) {
        var delta = 0;
        for (var nav = 2; nav < 6; nav++) {
          if (edges[nav]) keys[nav].repeatAt = time + 450;
          var repeated = keys[nav].down && keys[nav].raw && time >= keys[nav].repeatAt;
          if (edges[nav] || repeated) {
            delta = nav === 2 ? -1 : (nav === 3 ? 1 : (nav === 4 ? -5 : 5));
            if (repeated) keys[nav].repeatAt = time + 150;
            break;
          }
        }
        if (delta !== 0) {
          index = moveSelection(index, delta, cfg.packets.length + 1);
          targetIndex = 0;
          drawList(cfg, index);
        }
      }
      if (edges[0] && armed && index === cfg.packets.length) {
        try {
          var updated = loadConfig();
          validateConfig(updated);
          cfg = updated;
          index = 0;
          drawList(cfg, index);
          row(104, 'CONFIG RELOADED', C_ACC);
        } catch (reloadError) {
          row(104, 'CONFIG ERROR', C_WARN);
          console.log('LERC_CONFIG_ERROR ' + reloadError.message);
        }
        armed = false;
      } else if (armed && keys[0].down && keys[0].raw && !fault && index < cfg.packets.length) {
        if (edges[0]) { lastSend = -1000000; targetIndex = 0; }
        if (time - lastSend >= Number(cfgGet(cfg.packets[index], 'intervalMs', cfgGet(cfg, 'intervalMs', 100)))) {
          try {
            var packet = preparePacket(cfg, cfg.packets[index]);
            var target = packet.targets[targetIndex % packet.targets.length];
            var ad = buildAdv(target, packet.deviceType, packet.group, PACK_ID, packet.cmd, packet.params);
            if (ad === null || ad.length > 31) throw new Error('Invalid advertisement');
            var hex = bytesToHex(ad);
            if (!ble.rawAdv(hex, packet.advInterval)) throw new Error('BLE start failed');
            advertising = true;
            if (packet.onRelease !== null) {
              if (pending === null) pending = {packet: packet, targets: []};
              if (pending.targets.indexOf(target) < 0) pending.targets.push(target);
            }
            sent++;
            row(104, 'TX ' + sent + ' PID ' + bytesToHex([PACK_ID]), C_ACC);
            console.log('LERC_TX pid=' + PACK_ID + ' ad=' + hex);
            PACK_ID = (PACK_ID + 1) & 0xFF;
            targetIndex = (targetIndex + 1) % packet.targets.length;
            lastSend = now();
          } catch (sendError) {
            ble.rawAdvStop(); advertising = false; fault = true;
            row(104, 'TX ERROR - retry A', C_WARN);
            console.log('LERC_TX_ERROR ' + sendError.message);
          }
        }
      }
      delay(5);
    }
  } finally {
    try { sendRelease(pending); }
    finally { ble.rawAdvStop(); }
  }
  return index;
}

function main() {
  if (typeof ble.rawAdv !== 'function') {
    dialog.error('Update firmware: missing ble.rawAdv', true); return;
  }
  var cfg = loadConfig();
  try { validateConfig(cfg); }
  catch (configError) { dialog.error('Invalid packets.json: ' + configError.message, true); return; }
  runList(cfg);
  display.fill(C_BG);
}

try { main(); }
finally { ble.rawAdvStop(); }
