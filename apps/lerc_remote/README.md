# 乐式遥控包发射器（Bruce 扩展应用，不插卡）

把学而思这台 ESP32 当成一台"万能乐式遥控器"：按你在 `packets.json` 里定义的列表，
把 2.4G/BLE 遥控帧原样广播出去。整个应用是 Bruce 的 BJS 脚本，脚本和配置都放在
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

## 装到设备上

1. 刷入带 `ble.rawAdv()` 的固件（见文末"固件改动"）。
2. 设备开机后打开 WiFi 配置里的 WebUI（浏览器进设备 IP），用文件上传把
   `main.js`、`packets.json` 传到 **LittleFS 的 `/scripts/lerc_remote/`** 目录。
   也可以只传这两个文件到 `/scripts/` 下任意子目录，目录名就是菜单里的名字。
3. 主菜单进 `Scripts`，选 `[ lerc_remote ]` -> `main`。

改了 `packets.json` 再上传一次，应用里选"重新读取 packets.json"即可生效，不用重启。

## 按键

| 键 | 作用 |
| --- | --- |
| 上/下/左/右 | 列表里选择 |
| A（GPIO34） | 在发送界面**按住就连发**，松开停 |
| B（GPIO12） | 返回上一层 |

## packets.json

```json
{
  "intervalMs": 100,
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
| `intervalMs` | 连发间隔，默认 100ms；最小 20 |
| `targets` | 遥控器 ID 列表，4 字节，写成 `6012BAF1` 这种显示顺序即可（包内会自动转小端）。写多个就轮流发，和产测脚本行为一致 |
| `remoteId` | 只发一个目标时可以用它代替 `targets` |
| `deviceType` | 帧里的 RType，默认 `FE` |
| `group` | 帧里的 LampID（组 ID），默认 `00` |
| `startPackId` | 包序号起始值，不写就用开机毫秒数低 8 位。之后脚本运行期间一直自增（换包、退出再进都不重置），只有重新进脚本才回到起点 |
| `packets[].name` | 菜单里显示的名字 |
| `packets[].cmd` | 命令字，见 `catalog.json`，如 `00` 开灯、`02` 亮度+、`FE` 测试模式 |
| `packets[].params` | 参数字节，十六进制，最多 9 字节；没有参数就写 `""` |
| `packets[].remoteId` / `targets` / `group` / `deviceType` / `intervalMs` | 单条包独立覆盖全局设置 |

`_说明` 这种字段只是注释，程序会忽略。

## 帧格式

和《乐式 RF 数据包格式定义说明》「数据包帧说明」里的遥控器帧一致：

```
01 | RemoteID(4, 小端) | RType | LampID | PackId | Cmd | Plen | Params | CRC
```

- 前 5 字节（帧头 + ID）明文；
- 从 RType 起到 CRC，逐字节异或 V1 密钥，密钥下标 = 包内 ID 首字节低 4 位；
- CRC = 前面所有明文字节求和取反；
- 广播载荷 = `FF FF FF FF 0E` + 帧，外面套 AD 长度和 AD 类型 `FF`。

组包结果已用 `_tmp_verify_codec.py` 与 `产测脚本.py` 的
`build_remote_payload()` / `build_adv_data()` 逐字节比对，多组用例完全一致。
注意广播包总长不能超过 31 字节，也就是参数最多 9 字节。

## 固件改动

为了能发任意广播包，给 BJS 解释器的 `ble` 模块加了两个函数：

| 文件 | 改动 |
| --- | --- |
| `src/modules/bjs_interpreter/ble_js.cpp` | 新增 `native_bleRawAdv()` / `native_bleRawAdvStop()`：把整段 AD 数据灌进不可连接广播，可设广播间隔 |
| `src/modules/bjs_interpreter/ble_js.h` | 声明这两个函数 |
| `src/modules/bjs_interpreter/mqjs_stdlib.c` | 在 `js_ble[]` 里注册 `rawAdv` / `rawAdvStop` |

JS 侧用法：

```js
ble.rawAdv("14FFFFFFFFFF0E01F1BA1260...", 100)  // true 表示已开始广播
ble.rawAdvStop()                                // 停止（不释放协议栈）
ble.rawAdvStop(true)                            // 停止并 deinit
```

## 排错

- 菜单里看不到 `lerc_remote`：LittleFS 里没有 `/scripts/lerc_remote/main.js`，或扩展名不是 `.js/.bjs`。
- 提示"读取失败"：`packets.json` 不在和 `main.js` 同一目录。
- 提示"包参数不合法"：`remoteId/targets` 不是 4 字节，或 `params` 超过 9 字节。
- 灯没反应：先确认 `targets` 里是灯的遥控器 ID；用手机 BLE 扫描能看到这台设备在广播，
  但广告包是厂商数据 `FFFF` + `FF FF 0E`，普通扫描器不会显示名字。
