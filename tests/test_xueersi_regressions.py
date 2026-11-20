"""Run the actual display driver and configuration menu code on a host compiler."""
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def function(source, signature):
    start = source.index(signature)
    opening = source.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


COMMON = r'''
#include <cassert>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>
struct String : std::string {
    using std::string::string;
    String(int n) : std::string(std::to_string(n)) {}
    String(std::string s) : std::string(s) {}
};
struct Option {
    String label; std::function<void()> operation;
    bool selected; std::function<bool(void*, bool)> hover; void* data;
    Option(String s, std::function<void()> f, bool b=false,
           std::function<bool(void*,bool)> h=nullptr, void* p=nullptr)
        : label(s), operation(f), selected(b), hover(h), data(p) {}
};
std::vector<Option> options;
constexpr int MENU_TYPE_SUBMENU=1;
struct { uint16_t priColor=0xffff, secColor=0xffff, bgColor=0xffff;
         bool TerminalLog=false; void setTerminalLog(bool b) { TerminalLog=b; }
} bruceConfig;
struct { void fillScreen(uint16_t) {} } tft;
void addOptionToMainMenu() { options.emplace_back("Back", []{}); }
'''


def main():
    compiler = shutil.which('g++')
    if not compiler:
        raise SystemExit('g++ is required; these checks run in the cloud build.')
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)

        def run(source, name, flags=()):
            binary = directory / name
            subprocess.run([compiler, '-std=c++17', '-g', '-I', str(ROOT),
                            *flags, str(source), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True, timeout=30)
            print(f'PASS: {name}', flush=True)

        for name, flags in [
            ('display_rgb', ['-DTFT_RGB_ORDER=1', '-DXUEERSI_TFT_ZERO_OFFSET']),
            ('display_bgr', ['-DTFT_RGB_ORDER=0', '-DXUEERSI_TFT_ZERO_OFFSET']),
            ('display_default', []),
        ]:
            run(ROOT / 'tests/xueersi_display_regression.cpp', name, flags)

        settings = (ROOT / 'src/core/settings.cpp').read_text(encoding='utf-8')
        color = directory / 'color.cpp'
        color.write_text(COMMON + r'''
int expected;
int loopOptions(std::vector<Option>& opts, int, const char*, int initial) {
    assert(opts.size() == size_t(expected + 1));
    assert(initial >= 0 && initial < expected);
    for (int i=0; i<expected; ++i) {
        assert(opts[i].data);
        opts[i].hover(opts[i].data, true);
        opts[i].operation();
    }
    return expected-1;
}
''' + function(settings, 'uint16_t alterOneColorChannel565(') + '\n' +
            function(settings, 'void setCustomUIColorSettingMenu(\n') + r'''
int main() {
    for (int type=1; type<=3; ++type) for (int channel=1; channel<=3; ++channel) {
        expected = channel==2 ? 33 : 32;
        setCustomUIColorSettingMenu(type, channel, [=](uint16_t c, int i) {
            return alterOneColorChannel565(c, channel==1?i:256,
                                          channel==2?i:256, channel==3?i:256);
        });
    }
}
''', encoding='utf-8')
        run(color, 'color_bounds', ['-fsanitize=address,undefined', '-fno-omit-frame-pointer'])

        wifi = (ROOT / 'src/core/menu_items/WifiMenu.cpp').read_text(encoding='utf-8')
        menu = directory / 'wifi.cpp'
        stubs = ['wifiMACMenu', 'addEvilWifiMenu', 'removeEvilWifiMenu',
                 'setEvilGatewayIp', 'setEvilPasswordMode', 'setEvilEndpointCreds',
                 'setEvilAllowGetCreds', 'setEvilEndpointSsid', 'setEvilAllowSetSsid',
                 'setEvilAllowEndpointDisplay']
        menu.write_text(COMMON + '\n'.join(f'void {s}() {{}}' for s in stubs) + r'''
bool returnToMenu=false, showHiddenNetworks=false;
void displayInfo(String, bool) {}
struct WifiMenu { void configMenu(); };
int depth=0, count=0, nested=0;
int loopOptions(std::vector<Option>& opts, int, const char* title) {
    assert(++depth <= 2);
    int index;
    if (std::string(title)=="Evil Wifi Settings") { ++nested; index=opts.size()-1; }
    else if (count++ < 2000) index = count%3==0 ? 4 : (count%2 ? 3 : 5);
    else index=opts.size()-1;
    auto callback=opts[index].operation;
    callback();
    --depth;
    return index;
}
''' + function(wifi, 'void WifiMenu::configMenu()') + r'''
int main() { WifiMenu menu; menu.configMenu(); assert(count==2001); assert(nested>600); }
''', encoding='utf-8')
        run(menu, 'wifi_config_depth', ['-fsanitize=address,undefined', '-fno-omit-frame-pointer'])


if __name__ == '__main__':
    main()
