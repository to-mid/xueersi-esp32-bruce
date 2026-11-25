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
 *   广播载荷：FF FF FF FF 0E + 上面的帧，外面套 AD 长度与 AD 类型(FF)。
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
var ADV_PREFIX = [0xFF, 0xFF, 0xFF, 0xFF, 0x0E];

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

  var adv = [frame.length + ADV_PREFIX.length + 1, 0xFF];
  for (i = 0; i < ADV_PREFIX.length; i++) adv.push(ADV_PREFIX[i]);
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
  return {
    targets: targets, interval: interval, advInterval: advInterval, params: params,
    deviceType: oneByte(cfgGet(pkt, 'deviceType', cfgGet(cfg, 'deviceType', 'FE')), 0xFE),
    group: oneByte(cfgGet(pkt, 'group', cfgGet(cfg, 'group', '00')), 0),
    cmd: oneByte(pkt.cmd, 0), name: String(cfgGet(pkt, 'name', 'Packet'))
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

/* 发送界面：按住 A 连发，B 返回 */
function runPacket(cfg, pkt) {
  var prepared = preparePacket(cfg, pkt);
  var targets = prepared.targets, interval = prepared.interval;
  var deviceType = prepared.deviceType, group = prepared.group, cmd = prepared.cmd;
  var params = prepared.params, name = prepared.name;

  initPackId(cfg);
  var packId = PACK_ID;

  var sent = 0;
  var targetIndex = 0;
  var advertising = false;
  var lastSend = -1000000;
  var bWasHigh = true;

  gpio.pinMode(KEY_A, INPUT);
  // GPIO12 needs the board's internal pull-up; INPUT leaves B floating low.
  gpio.pinMode(KEY_B, INPUT_PULLUP);

  display.fill(C_BG);
  row(2, name, C_ACC, 2);
  row(22, "Hold A: TX   B: Back", C_DIM);
  row(34, "TGT " + targets[0], C_FG);
  row(46, "CMD " + bytesToHex([cmd]) + "  DT " + bytesToHex([deviceType]) + "  G " + bytesToHex([group]), C_FG);
  row(58, "PARAM " + (params.length === 0 ? "-" : bytesToHex(params, " ")), C_FG);

  row(72, "Release A to arm", C_DIM);
  while (gpio.digitalRead(KEY_A) === 0) {
    if (gpio.digitalRead(KEY_B) === 0) return;
    delay(5);
  }
  delay(25);
  row(72, "READY - hold A", C_ACC);
  try {
  while (true) {
    // B 键直接读电平取按下沿：不调用 check()，免得反复挂起 Bruce 的按键扫描任务
    var bNow = gpio.digitalRead(KEY_B);
    if (bWasHigh && bNow === 0) break;
    bWasHigh = (bNow !== 0);

    if (gpio.digitalRead(KEY_A) === 0) {
      var t = now();
      if (t - lastSend >= interval) {
        var target = targets[targetIndex % targets.length];
        var adv = buildAdv(target, deviceType, group, packId, cmd, params);
        if (adv === null) {
          dialog.error("包参数不合法（ID 或参数长度）");
          break;
        }
        if (adv.length > 31) {
          dialog.error("广播包 " + adv.length + " 字节，超过 31 字节上限");
          break;
        }
        var hex = bytesToHex(adv);
        if (!ble.rawAdv(hex, prepared.advInterval)) {
          dialog.error("BLE 广播启动失败");
          break;
        }
        advertising = true;
        sent++;
        lastSend = t;

        row(34, "TGT " + target, C_FG);
        row(72, "SENT " + sent + "  PID " + bytesToHex([packId]), C_ACC);
        row(84, "ADV " + bytesToHex(adv, " "), C_DIM);

        PACK_ID = (packId + 1) & 0xFF;
        packId = PACK_ID;
        targetIndex = (targetIndex + 1) % targets.length;
      }
    } else if (advertising) {
      ble.rawAdvStop();
      advertising = false;
      row(72, "SENT " + sent + "  STOPPED", C_DIM);
    }

    delay(5);
  }
  } finally {
    ble.rawAdvStop();
  }
}

function main() {
  if (typeof ble.rawAdv !== 'function') {
    dialog.error("Update firmware: missing ble.rawAdv", true);
    return;
  }
  var cfg = loadConfig();
  if (cfg === null) {
    dialog.error("Cannot read packets.json", true);
    return;
  }
  try { validateConfig(cfg); }
  catch (configError) { dialog.error(configError.message, true); return; }
  var packets = cfgGet(cfg, "packets", []);
  if (packets.length === 0) {
    dialog.error("packets.json 里没有任何包");
    return;
  }
  console.log("LERC_READY packets=" + packets.length + " fs=littlefs");

  while (true) {
    var list = [];
    var i;
    for (i = 0; i < packets.length; i++) {
      var p = packets[i];
      var label = (i + 1) + ". " + String(cfgGet(p, "name", "包" + (i + 1)));
      var tail = String(cfgGet(p, "cmd", ""));
      if (tail !== "") label += " [" + tail + "]";
      list.push([label, String(i)]);
    }
    list.push(["-- Reload packets.json", "reload"]);
    list.push(["-- Exit", "exit"]);

    var pick = dialog.choice(list);
    if (pick === "" || pick === "exit") break;
    if (pick === "reload") {
      var again = loadConfig();
      if (again !== null) {
        try {
          validateConfig(again);
          cfg = again;
          packets = cfg.packets;
        } catch (reloadError) { dialog.error(reloadError.message, true); }
      } else {
        dialog.error("Cannot read packets.json", true);
      }
      continue;
    }
    var index = parseInt(pick, 10);
    if (isNaN(index) || index < 0 || index >= packets.length) continue;
    try { runPacket(cfg, packets[index]); }
    catch (sendError) { ble.rawAdvStop(); dialog.error(sendError.message, true); }
  }

  ble.rawAdvStop();
  display.fill(C_BG);
}

try { main(); }
finally { ble.rawAdvStop(); }
