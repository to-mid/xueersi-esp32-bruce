# -*- coding: utf-8 -*-
"""从《乐式 RF 数据包格式定义说明》的「遥控器命令表」导出完整命令目录。

用法：
    python gen_packets.py "D:\\path\\乐式-DOC0-...xlsx"
默认读取同目录上上级的文档路径见 DEFAULT_XLSX，导出 catalog.json（纯参考用，
需要发哪条命令就复制到 packets.json 里改成自己需要的参数）。

只依赖 Python 标准库，不需要装 openpyxl。
"""
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

DEFAULT_XLSX = Path(r"C:\Users\czy\Documents\工作项目\乐式-DOC0-乐式RF数据包格式定义说明-20240715-92-V2.3.4.xlsx")
SHEET_NAME = "遥控器命令表"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def col_index(ref):
    m = re.match(r"([A-Z]+)", ref)
    n = 0
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_sheet(path, sheet_name):
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(NS + "si"):
                shared.append("".join(t.text or "" for t in si.iter(NS + "t")))

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        relmap = {r.get("Id"): r.get("Target") for r in rels}

        target = None
        for s in wb.find(NS + "sheets"):
            if s.get("name") == sheet_name:
                rid = s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
                target = relmap[rid]
                target = target if target.startswith("xl/") else "xl/" + target.lstrip("/")
                break
        if target is None:
            raise SystemExit("找不到工作表: %s" % sheet_name)

        root = ET.fromstring(z.read(target))
        rows = []
        for row in root.iter(NS + "row"):
            cells = {}
            for c in row.findall(NS + "c"):
                t = c.get("t")
                v = c.find(NS + "v")
                isv = c.find(NS + "is")
                if t == "s" and v is not None:
                    txt = shared[int(v.text)]
                elif t == "inlineStr" and isv is not None:
                    txt = "".join(x.text or "" for x in isv.iter(NS + "t"))
                elif v is not None:
                    txt = v.text or ""
                else:
                    txt = ""
                txt = txt.strip().replace("\n", " ")
                if txt:
                    cells[col_index(c.get("r"))] = txt
            rows.append(cells)
        return rows


def parse_cmd(raw):
    m = re.match(r"0[xX]([0-9A-Fa-f]{1,2})", raw)
    return m.group(1).upper() if m else None


def main():
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    rows = read_sheet(xlsx, SHEET_NAME)
    out = []
    seen = set()
    for cells in rows:
        cmd = parse_cmd(cells.get(2, ""))
        if cmd is None:
            continue
        func = cells.get(4, "")
        name = cells.get(8, "")
        params = " | ".join(cells.get(i, "") for i in range(11, 19) if cells.get(i, ""))
        key = (cmd, func, name)
        if key in seen:
            continue
        seen.add(key)
        out.append({"cmd": cmd, "功能": func, "命名": name, "参数/说明": params})

    dest = Path(__file__).with_name("catalog.json")
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("导出 %d 条命令 -> %s" % (len(out), dest))


if __name__ == "__main__":
    main()
