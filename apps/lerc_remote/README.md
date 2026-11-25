# 乐式遥控包发射器（Bruce 扩展应用，不插卡）

把学而思这台 ESP32 当成一台"万能乐式遥控器"：按你在 `packets.json` 里定义的列表，
把参考产测脚本中的 BLE 遥控帧广播出去。这里是 BLE 广播，并非任意 2.4GHz RF 调制协议。整个应用是 Bruce 的 BJS 脚本，脚本和配置都放在
片内 LittleFS 上，**不需要 SD 卡**。

```
主菜单 -> Scripts -> lerc_remote -> main
```

## 文件

| 文件 | 作用 |
| --- | --- |
| `main.js` | 应用本体：列表菜单、组包、加密、按住连发 |
| `packets.json` | 你的包列表（改这里就行，不用动代码） |
| `catalog.json` | 从协议表「遥控器命令表」导出的 116 条命令，纯参考 |
| `gen_packets.py` | 重新导出 catalog.json |
| `install.py` | 通过 USB 安装应用或只更新包列表，含备份和 MD5 回读校验 |
| `test_remote.js` / `verify_reference.py` | 按键/边界回归及与产测脚本的 256 组差分测试 |

## 装到设备上

1. 刷入带 `ble.rawAdv()` / `ble.rawAdvStop()` 的固件；首次需更新固件，以后改包列表不需要重刷。
2. 不插 TF 卡，在本文件所在目录运行：

   ```powershell
   python -m pip install pyserial
   python install.py --port COM14 --launch
   ```

   程序先检查固件接口，确认没有挂载 TF 卡，上传到 **LittleFS 的 `/BruceJS/lerc_remote/`**，并回读 MD5 校验。已有文件会先备份到电脑端 `output/日期时间/`。
3. 主菜单进 `JS Interpreter`（部分主题名为 `Scripts`），选 `[ lerc_remote ]` -> `main`。沿用现有 `/BruceJS` 根目录，不新建优先级更高的 `/scripts`，因此不会遮住已安装的 App Store。

也可以通过 WebUI 上传这两个文件到同一目录，选择 LittleFS。`catalog.json` 是电脑端的命令说明，不必上传掌机。

改包列表后只需执行：

```powershell
python install.py --port COM14 --config-only --launch
```

可用 `--config 其他文件.json` 安装自己的包列表。USB 更新会先退出正在运行的 JS 应用；WebUI 更新后可在应用内选 `Reload packets.json`，错误配置不会替换当前有效列表。只有按住 A 时发送，进入菜单和选中包都不会自动发送。

## 按键

| 键 | 作用 |
| --- | --- |
| 上/下/左/右 | 列表里选择 |
| A（GPIO34） | 在发送界面**按住就连发**，松开停 |
| B（GPIO12） | 返回上一层 |

进入发送界面先松开 A，看到 `READY - hold A` 后重新按住发送。松开 A 或按 B 都会停止广播；退出脚本或脚本异常时，固件也会停止并释放这次原始广播。此机制不能替代断电等硬件故障下的验证。

## packets.json

```json
{
  "intervalMs": 100,
  "advIntervalMs": 20,
  "startPackId": 186,
  "targets": ["6012BAF1", "FFFFFFFF"],
  "deviceType": "FE",
  "group": "00",
  "packets": [
    { "name": "开灯", "cmd": "00", "params": "01" }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `intervalMs` | 更新命令/轮换目标间隔，默认 100ms，范围 20–60000ms |
| `advIntervalMs` | 同一包的 BLE 广播间隔，默认 20ms，范围 20–10240ms；与目标轮换间隔独立，默认匹配产测脚本 |
| `targets` | 遥控器 ID 列表，4 字节，写成 `6012BAF1` 这种显示顺序即可（包内会自动转小端）。写多个就轮流发，和产测脚本行为一致 |
| `remoteId` | 只发一个目标时可以用它代替 `targets` |
| `deviceType` | 帧里的 RType，默认 `FE` |
| `group` | 帧里的 LampID（组 ID），默认 `00` |
| `startPackId` | 首包序号；示例 186 即 BA（也可写字符串 `"BA"`）。不写则用开机毫秒数低 8 位；换包或返回包列表不会重置，退出整个脚本重新运行才重置 |
| `packets[].name` | 菜单名字，建议英文；当前屏幕字体不保证中文，示例因此使用英文 |
| `packets[].cmd` | 命令字，见 `catalog.json`，如 `00` 开灯、`02` 亮度+、`FE` 测试模式 |
| `packets[].params` | 参数字节，十六进制，最多 9 字节；没有参数就写 `""` |
| `packets[].remoteId` / `targets` / `group` / `deviceType` / `intervalMs` / `advIntervalMs` | 单条包独立覆盖全局设置 |

`_说明` 这种字段只是注释，程序会忽略。

`cmd`、`params`、地址和字符串类型的单字节字段按十六进制解释，可带空格、冒号或短横线，不能有奇数字符或非法字符。数字类型的单字节字段须为 0–255 的整数。所有条目在启动和重载时先检查，错误会指出条目序号。

默认 29 个示例包括开关灯、调光、色温、RGB、情景、对码及参考产测命令。除产测示例沿用提供的实际脚本外，各功能能否响应取决于灯具支持的命令和参数范围。协议未给出的亮度百分比不作推断，示例直接标注原始值 `0x0080` / `0x00FF`。`FFFFFFFF` 是协议保留的免对码测试 ID，仅沿用产测脚本作为默认示例，实际产品遥控器应填写自己的 ID。

## 帧格式

和《乐式 RF 数据包格式定义说明》「数据包帧说明」里的遥控器帧一致：

```
01 | RemoteID(4, 小端) | RType | LampID | PackId | Cmd | Plen | Params | CRC
```

- 前 5 字节（帧头 + ID）明文；
- 从 RType 起到 CRC，逐字节异或 V1 密钥，密钥下标 = 包内 ID 首字节低 4 位；
- CRC = 前面所有明文字节求和取反；
- 广播载荷 = `FF FF FF FF 0E` + 帧，外面套 AD 长度和 AD 类型 `FF`。

组包结果用 `verify_reference.py` 提取实际 `产测脚本.py` 的
`build_remote_payload()` / `build_adv_data()`，与 JS 的 256 组数据逐字节比对，覆盖全部 16 种 V1 密钥、序号边界和不同参数长度。
协议本身规定 `Plen=max9`；BLE 传统广播还另有总长不超过 31 字节的限制。

```powershell
node test_remote.js
python verify_reference.py "C:\路径\产测脚本.py"
python preview.py
```

## 固件改动

为了能发任意广播包，给 BJS 解释器的 `ble` 模块加了两个函数：

| 文件 | 改动 |
| --- | --- |
| `src/modules/bjs_interpreter/ble_js.cpp` | 新增 `native_bleRawAdv()` / `native_bleRawAdvStop()`：把整段 AD 数据灌进不可连接广播，可设广播间隔 |
| `src/modules/bjs_interpreter/ble_js.h` | 声明这两个函数 |
| `src/modules/bjs_interpreter/mqjs_stdlib.c` | 在 `js_ble[]` 里注册 `rawAdv` / `rawAdvStop` |
| `src/modules/bjs_interpreter/interpreter.cpp` | JS 执行结束后停止并释放本次原始广播，再展示异常或返回菜单 |

JS 侧用法：

```js
ble.rawAdv("02FF00", 20)                    // 完整 AD 数据示例；true 表示已开始广播
ble.rawAdvStop()                                // 停止（不释放协议栈）
ble.rawAdvStop(true)                            // 停止并 deinit
```

## 排错

- 菜单里看不到 `lerc_remote`：LittleFS 里没有 `/BruceJS/lerc_remote/main.js`，或扩展名不是 `.js/.bjs`。若自行创建过 `/scripts` / `/BruceScripts`，固件会优先列出那里的内容，可用 `Load...` 手动打开本应用。
- 提示"读取失败"：`packets.json` 不在和 `main.js` 同一目录。
- 提示"包参数不合法"：`remoteId/targets` 不是 4 字节，或 `params` 超过 9 字节。
- 灯没反应：先确认 `targets` 里是灯的遥控器 ID；用手机 BLE 扫描能看到这台设备在广播，
  但广告包是厂商数据 `FFFF` + `FF FF 0E`，普通扫描器不会显示名字。
