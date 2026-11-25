# -*- coding: utf-8 -*-
"""在电脑上预览 packets.json 每条包最终发出的广播数据（不用开机就能核对）。

用法：
    python preview.py            # 预览同目录 packets.json
    python preview.py other.json

组包逻辑和 main.js 里的 CODEC 段完全一致（已逐字节对比过产测脚本）。
"""
import json
import sys
from pathlib import Path

V1_KEYS = [
    0xCB, 0x6A, 0x95, 0x8D, 0xB6, 0x7B, 0x35, 0x5A,
    0x6E, 0x49, 0x5C, 0x85, 0x37, 0x3C, 0xA6, 0x88,
]
ADV_PREFIX = bytes([0xFF, 0xFF, 0xFF, 0xFF])
HEX = "0123456789ABCDEF"


def hex_bytes(s):
    text = str(s or "")
    if any(c not in HEX + HEX.lower() + " \t\r\n:-" for c in text):
        raise ValueError("Invalid hex: %r" % s)
    clean = "".join(c for c in text if c in HEX + HEX.lower())
    return bytes.fromhex(clean)


def build_adv(target, device_type, group, pack_id, cmd, params):
    rid = hex_bytes(target)
    if len(rid) != 4:
        raise ValueError("target 必须是 4 字节: %r" % target)
    if len(params) > 9:
        raise ValueError("params 最多 9 字节，当前 %d 字节" % len(params))
    wire = bytes([rid[3], rid[2], rid[1], rid[0]])
    frame = bytearray([0x01])
    frame.extend(wire)
    frame.extend([device_type, group, pack_id & 0xFF, cmd, len(params)])
    frame.extend(params)
    frame.append((~sum(frame)) & 0xFF)
    key = V1_KEYS[wire[0] & 0x0F]
    for i in range(5, len(frame)):
        frame[i] ^= key
    data = ADV_PREFIX + bytes([len(frame)]) + bytes(frame)
    return bytes([len(data) + 1, 0xFF]) + data


def one_byte(v, dflt):
    if isinstance(v, int):
        if not 0 <= v <= 255:
            raise ValueError('Byte outside 0..255')
        return v
    b = hex_bytes(v)
    if len(b) > 1:
        raise ValueError('Expected one byte')
    return b[0] if b else dflt


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("packets.json")
    cfg = json.loads(path.read_text(encoding="utf-8"))

    interval = cfg.get("intervalMs", 100)
    dev = one_byte(cfg.get("deviceType", "FE"), 0xFE)
    group = one_byte(cfg.get("group", "00"), 0x00)
    pack_id = one_byte(cfg.get("startPackId", 0), 0)
    targets = cfg.get("targets") or ([cfg["remoteId"]] if cfg.get("remoteId") else [])

    print("配置: %s" % path)
    print("目标: %s  间隔: %sms  RType: %02X  组ID: %02X  起始包ID: %02X"
          % (",".join(targets), interval, dev, group, pack_id))
    print()

    ok = True
    for i, pkt in enumerate(cfg.get("packets", [])):
        name = pkt.get("name", "包%d" % (i + 1))
        pkt_targets = pkt.get("targets") or ([pkt["remoteId"]] if pkt.get("remoteId") else targets) or [""]
        p_dev = one_byte(pkt.get("deviceType", dev), dev)
        p_group = one_byte(pkt.get("group", group), group)
        cmd = one_byte(pkt.get("cmd", "00"), 0x00)
        params = hex_bytes(pkt.get("params", ""))
        try:
            adv = build_adv(pkt_targets[0], p_dev, p_group, pack_id, cmd, params)
        except ValueError as exc:
            ok = False
            print("[%02d] %-22s 参数错误: %s" % (i + 1, name, exc))
            continue
        flag = "" if len(adv) <= 31 else "  <-- 超过 31 字节!"
        if len(adv) > 31:
            ok = False
        print("[%02d] %-22s cmd=%02X %-18s %d字节  %s%s"
              % (i + 1, name, cmd, params.hex().upper() or "-", len(adv), adv.hex().upper(), flag))
        pack_id = (pack_id + 1) & 0xFF

    print()
    print("全部合法" if ok else "有不合法的条目，见上面的提示")


if __name__ == "__main__":
    main()
