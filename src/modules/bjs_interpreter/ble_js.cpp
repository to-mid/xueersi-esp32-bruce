#if !defined(LITE_VERSION) && !defined(DISABLE_INTERPRETER)
#include "ble_js.h"
#include "modules/ble/ble_common.h"

JSValue native_bleScan(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    // usage: ble.scan(timeout_seconds)
    // returns: array of objects [{name, address, rssi}, ...]
    int timeout = 5; // default 5 seconds
    if (argc > 0 && JS_IsNumber(ctx, argv[0])) {
        JS_ToInt32(ctx, &timeout, argv[0]);
    }
    if (timeout < 1) timeout = 1;
    if (timeout > 30) timeout = 30;

    BLEDevice::init("");
    NimBLEScan *pScan = BLEDevice::getScan();
    pScan->setActiveScan(true);
    pScan->setInterval(100);
    pScan->setWindow(99);

#if __has_include(<NimBLEExtAdvertising.h>)
    BLEScanResults results = pScan->getResults(timeout * 1000, false);
    int count = results.getCount();
#else
    BLEScanResults results = pScan->start(timeout, false);
    int count = results.getCount();
#endif

    JSValue arr = JS_NewArray(ctx, 0);
    for (int i = 0; i < count; i++) {
#if __has_include(<NimBLEExtAdvertising.h>)
        const NimBLEAdvertisedDevice *dev = results.getDevice(i);
#else
        NimBLEAdvertisedDevice dev_obj = results.getDevice(i);
        NimBLEAdvertisedDevice *dev = &dev_obj;
#endif
        JSValue obj = JS_NewObject(ctx);
        String name = dev->getName().c_str();
        if (name.isEmpty()) name = "<unknown>";
        JS_SetPropertyStr(ctx, obj, "name", JS_NewString(ctx, name.c_str()));
        JS_SetPropertyStr(ctx, obj, "address", JS_NewString(ctx, dev->getAddress().toString().c_str()));
        JS_SetPropertyStr(ctx, obj, "rssi", JS_NewInt32(ctx, dev->getRSSI()));
        JS_SetPropertyUint32(ctx, arr, i, obj);
    }

    pScan->clearResults();
    return arr;
}

JSValue native_bleAdvertise(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    // usage: ble.advertise(name_string)
    const char *name = "Bruce-App";
    JSCStringBuf name_buf;
    if (argc > 0 && JS_IsString(ctx, argv[0])) {
        name = JS_ToCString(ctx, argv[0], &name_buf);
    }

    BLEDevice::init(name);
    NimBLEServer *pServer = BLEDevice::createServer();
    pServer->getAdvertising()->start();

    return JS_NewBool(true);
}

JSValue native_bleStopAdvertise(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    NimBLEDevice::getAdvertising()->stop();
    BLEDevice::deinit();
    return JS_UNDEFINED;
}

// ---------------------------------------------------------------------------
// 原始广播包发送：把一段完整的 AD 结构（含长度字节、AD 类型、厂商数据）原样
// 灌进广播载荷，用于发送 2.4G/BLE 遥控器等自定义协议包。
//   ble.rawAdv("14ff ffffffff0e ...", 100)  -> bool
//   ble.rawAdvStop()                         -> 停止广播
// ---------------------------------------------------------------------------

static bool bjsRawAdvRunning = false;

static int bjsHexNibble(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

JSValue native_bleRawAdv(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    // usage: ble.rawAdv(hex_string, interval_ms?)
    // hex_string 为完整 AD 数据（例："14ffffffffff 0e 01 f1ba1260 fe ..."），最长 31 字节。
    if (argc < 1 || !JS_IsString(ctx, argv[0])) {
        return JS_ThrowTypeError(ctx, "ble.rawAdv(hexString, intervalMs?) expects a hex string");
    }
    JSCStringBuf hex_buf;
    const char *hex = JS_ToCString(ctx, argv[0], &hex_buf);
    if (hex == nullptr) return JS_NewBool(false);

    uint8_t advData[31];
    size_t advLen = 0;
    int highNibble = -1;
    for (const char *p = hex; *p != '\0'; ++p) {
        int nibble = bjsHexNibble(*p);
        if (nibble < 0) continue; // 忽略空格、冒号、换行等分隔符
        if (highNibble < 0) {
            highNibble = nibble;
            continue;
        }
        if (advLen >= sizeof(advData)) return JS_NewBool(false);
        advData[advLen++] = (uint8_t)((highNibble << 4) | nibble);
        highNibble = -1;
    }
    // 奇数个十六进制字符或长度过短（不足以构成一条 AD 结构）都视为无效
    if (highNibble >= 0 || advLen < 3) return JS_NewBool(false);

    int intervalMs = 100;
    if (argc > 1 && JS_IsNumber(ctx, argv[1])) {
        JS_ToInt32(ctx, &intervalMs, argv[1]);
    }
    // 广播间隔：NimBLE 以 0.625ms 为单位，最小 20ms
    if (intervalMs < 20) intervalMs = 20;
    if (intervalMs > 10240) intervalMs = 10240;

    // 不创建 GATT server，广播即为不可连接广播，扫描器连不上、不会打断发包
    BLEDevice::init("");
    BLEAdvertising *adv = BLEDevice::getAdvertising();
    if (adv == nullptr) return JS_NewBool(false);

    if (bjsRawAdvRunning) adv->stop();

    uint16_t intervalUnits = (uint16_t)(intervalMs * 8 / 5);
    adv->setMinInterval(intervalUnits);
    adv->setMaxInterval(intervalUnits);

    BLEAdvertisementData data;
    data.addData(advData, advLen);
    adv->setAdvertisementData(data);

    bjsRawAdvRunning = adv->start();
    return JS_NewBool(bjsRawAdvRunning);
}

JSValue native_bleRawAdvStop(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    // usage: ble.rawAdvStop(deinit?)  deinit 为 true 时顺带释放 BLE 协议栈
    bool deinit = false;
    if (argc > 0) deinit = JS_ToBool(ctx, argv[0]);

    BLEAdvertising *adv = BLEDevice::getAdvertising();
    if (adv != nullptr) adv->stop();
    bjsRawAdvRunning = false;

    if (deinit) {
        vTaskDelay(5 / portTICK_PERIOD_MS);
        BLEDevice::deinit();
    }
    return JS_UNDEFINED;
}

#endif
