# 乐式遥控器（Bruce 扩展应用，不插 TF 卡）

应用和自定义包列表保存在内部 LittleFS：`/BruceJS/lerc_remote/`。
打开 `JS Interpreter → lerc_remote → main`。发送的是乐式 V1 遥控帧的 BLE 厂商广播。

## 列表直接发包

| 按键 | 操作 |
| --- | --- |
| 上 / 下 | 选择上一条 / 下一条，首尾循环；长按滚动 |
| 左 / 右 | 前后移动 5 项 |
| A | **直接发送当前选中项**，按住连发，松开停止；不进入二级页面 |
| B | 停止发送并退出应用 |

列表下方显示当前命令、参数、发送计数及包序号。发送期间保持选中项；换项前先松开 A。
从 Bruce 打开应用时若仍按着 A，先松开再按，避免打开应用的确认键触发广播。
最后一项是 `Reload packets.json`，按 A 重新读取配置；非法配置会保留原列表。

使用独立的 GPIO 消抖读取，避免通用菜单的翻页按键行为影响上下选择。B、上、下、左保留内部上拉，A 和右使用板上的外部上拉。

## 当前默认配置

第一项 `Light ON` 按用户提供的接收日志设置：遥控器 ID `0AD3C5AB`、组 `00`、命令 `00`、参数 **`01 AA AA 00 00`**，首包序号 `01`。

```text
解密帧：01 AB C5 D3 0A FE 00 01 00 05 01 AA AA 00 00 58
厂商数据：FF FF FF FF 10 01 AB C5 D3 0A 7B 85 84 85 80 84 2F 2F 85 85 DD
完整 AD：16 FF FF FF FF FF 10 01 AB C5 D3 0A 7B 85 84 85 80 84 2F 2F 85 85 DD
```

三种表示的区别：厂商数据外增加了 AD 长度和类型 `FF` 才是传给 `ble.rawAdv()` 的完整 AD。
厂商头 `FF FF FF FF` 后的字节是**后续帧长度**：5 字节参数为 `10`，3 字节参数为 `0E`，不可固定为 `0E`。
包序号每次更新递增，因此后续包的加密序号和 CRC 会变化；换项不会重置序号。

仍保留 29 条可编辑示例，其他功能的参数需按实际灯具支持情况调整。
`Production test` 单独保留原产测脚本的两个目标 `6012BAF1` / `FFFFFFFF` 和参数，不随普通条目的默认遥控器 ID 改变。

## 修改自己的包列表

编辑本目录的 `packets.json`，然后在此目录执行：

```powershell
python install.py --port COM14 --config-only --launch
```

不用重编固件。也可以用 `--config 其他文件.json` 安装另一份列表。
安装工具退出当前 JS，备份旧文件到电脑 `output/日期时间/`，上传临时文件，通过 BJS 回读完整字节并在电脑核对 MD5 后替换。

```json
{
  "intervalMs": 100,
  "advIntervalMs": 20,
  "startPackId": 1,
  "targets": ["0AD3C5AB"],
  "deviceType": "FE",
  "group": "00",
  "packets": [
    {"name": "Light ON", "cmd": "00", "params": "01AAAA0000"}
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `targets` | 4 字节遥控器 ID 列表，多个则交替发；`remoteId` 可代替单目标列表。显示顺序输入，帧内自动转小端 |
| `deviceType` / `group` | RType / LampID，默认 `FE` / `00` |
| `intervalMs` | 更新包序号及轮换目标的间隔，默认 100ms，范围 20–60000ms |
| `advIntervalMs` | 同一包的 BLE 广播间隔，默认 20ms，范围 20–10240ms |
| `startPackId` | 首包序号，数字 1 或十六进制字符串 `"01"`；退出应用重开才重置 |
| `packets[].name` | 列表名称，建议英文，当前字体不保证中文显示 |
| `packets[].cmd` | 单字节命令，见 `catalog.json` 的 116 条命令参考 |
| `packets[].params` | 十六进制参数，最多 9 字节，无参数用 `""` |
| 条目覆盖 | 单项可覆盖 `targets` / `remoteId` / `deviceType` / `group` / `intervalMs` / `advIntervalMs` |

十六进制字符串允许空格、冒号、短横线；数字单字节必须为 0–255 整数。启动及重载前校验全部条目。
`FFFFFFFF` 是保留测试 ID；普通产品遥控器应填自己的 ID。

## 首次安装

需要支持 `ble.rawAdv()` / `ble.rawAdvStop()` 的 Bruce 固件。COM14 已安装对应固件。

```powershell
python -m pip install pyserial
python install.py --port COM14 --launch
```

工具要求没有挂载 TF 卡，文件写入 LittleFS 的 `/BruceJS/lerc_remote`；沿用 `/BruceJS`，现有 App Store 仍可见。
`catalog.json` 是电脑参考，不必占用设备存储。

## 帧格式与编码

```text
明文帧：01 | RemoteID LE4 | RType | LampID | PackId | Cmd | Plen | Params | CRC
厂商数据：FF FF FF FF | 帧长 | 加密帧
完整 AD：AD长度 | FF | 厂商数据
```

CRC 为此前全部明文字节累加取反。帧头和 ID 共 5 字节明文，其余字节（包括 CRC）与 V1 密钥异或，密钥索引取包内 ID 首字节的低四位。
协议参数上限 9 字节，完整传统 BLE AD 另受 31 字节限制。

原产测脚本固定 3 字节参数，厂商帧长度因此写死 `0E`；可变长度应用现已按实际帧长度生成。
`verify_reference.py` 对 256 组加密帧与实际脚本做差分，独立校验长度，并对其中 64 组 3 字节参数的完整 AD 验证兼容。
用户提供的 5 字节开灯抓包另作固定回归向量，包含精确的完整 AD、CRC 和加密字节。

```powershell
node test_remote.js
python verify_reference.py "C:\路径\产测脚本.py"
python preview.py
```

## 验证记录（2026-11-25）

- 云编译 `45609513167` 成功，COM14 固件为 `73c8f9080246bc5840d5fac4e070a73225947b9f`，写后校验通过；完整备份留在电脑，保留 NVS 和 LittleFS。PSRAM 启动正常。
- 修复 B 键误返回：`INPUT` 无按键时 100/100 读低，`INPUT_PULLUP` 下 0/100 读低。
- 列表直接发送回归覆盖上键首尾循环、短脉冲消抖、长按滚动、A 直接发送/松开停止、B 返回、发送失败等待重新按 A、引脚上拉及 160×128 行位置。
- 实机解释器使用模拟上下/A 时序和真实 B 电平，完成上翻/下翻、4 次发送与正常退出；计算出的首个开灯 AD 与抓包逐字节一致。无线发送替换为通用测试 AD `02FF00`，没有自动发送乐式控制或产测命令。
- Windows 蓝牙扫描不可用；**未验证空中接收或灯具响应**，实际按键和灯具兼容性需用户试用。

## 固件接口

`ble.rawAdv(hex, intervalMs)` 发送完整 AD，使用不可连接广播；`ble.rawAdvStop()` 停止，传 `true` 同时释放 BLE。
解释器退出时兜底停止本次原始广播。当前这次列表和长度修复只更新 JS/JSON，无需重刷固件。
