#include <cassert>
#include <cstdint>
#include <initializer_list>
#include "src/core/status_layout.h"

#define TFT_RGB 1
#define TFT_BGR 0
#define ST7735_GREENTAB
#include "lib/TFT_eSPI/TFT_Drivers/ST7735_Defines.h"

int rotation, colstart, rowstart, tabcolor = INITR_GREENTAB;
int _width, _height, _init_width = 128, _init_height = 160;
uint8_t madctl;
void writecommand(uint8_t) {}
void writedata(uint8_t value) { madctl = value; }
void rotate(uint8_t m) {
#include "lib/TFT_eSPI/TFT_Drivers/ST7735_Rotation.h"
}

int main() {
    for (int width : {128, 160, 240, 320, 480}) {
        for (int label : {48, 66, 100}) {
            for (int count = 0; count <= 6; ++count) {
              for (int margin : {12, 48, 89}) {
                auto layout = statusIconLayout(12 + label, width - margin, count);
                assert(layout.count >= 0 && layout.count <= count);
                if (layout.count) {
                    assert(layout.start >= 12 + label + 6);
                    assert(layout.start + layout.count * 16 + (layout.count - 1) * 6 == width - margin);
                }
              }
            }
        }
    }
    for (int previous = 0; previous < 4; ++previous) {
        for (int next = 0; next < 4; ++next) {
            rotate(previous);
            rotate(next);
            assert(_width == ((next & 1) ? 160 : 128));
            assert(_height == ((next & 1) ? 128 : 160));
#ifdef XUEERSI_TFT_ZERO_OFFSET
            assert(colstart == 0 && rowstart == 0);
#else
            assert(colstart == ((next & 1) ? 1 : 2));
            assert(rowstart == ((next & 1) ? 2 : 1));
#endif
#if defined(TFT_RGB_ORDER) && TFT_RGB_ORDER == TFT_RGB
            assert((madctl & 0x08) == 0);
#else
            assert((madctl & 0x08) == 0x08);
#endif
        }
    }
}
