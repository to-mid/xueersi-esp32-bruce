#include "core/powerSave.h"
#include <interface.h>

/***************************************************************************************
** Function name: _setup_gpio()
** Location: main.cpp
** Description:   initial setup for the device
***************************************************************************************/
void _setup_gpio() {
    // Buttons with internal pull-up support (GPIO2/12/13/27)
    pinMode(UP_BTN, INPUT_PULLUP);
    pinMode(DW_BTN, INPUT_PULLUP);
    pinMode(L_BTN, INPUT_PULLUP);
    pinMode(ESC_BTN, INPUT_PULLUP);  // KEY_B, button to GND
    // Input-only pins (GPIO34/35): internal pull-up NOT available,
    // require external 10k pull-up resistors to 3V3.
    pinMode(R_BTN, INPUT);
    pinMode(SEL_BTN, INPUT);

    // Keep TFT CS high until the display driver takes over
    pinMode(TFT_CS, OUTPUT);
    digitalWrite(TFT_CS, HIGH);

    // Keep the TF (microSD) card deselected until setupSdCard() mounts it
#ifdef SDCARD_CS
    if (SDCARD_CS >= 0) {
        pinMode(SDCARD_CS, OUTPUT);
        digitalWrite(SDCARD_CS, HIGH);
    }
#endif

    // This panel is NOT color-inverted by default (the firmware's generic
    // default is inverted). Set the board default before the saved config is
    // loaded; _post_setup_gpio() re-asserts it after loading.
    bruceConfig.colorInverted = 0;

    bruceConfig.startupApp = "Launcher";
}

/***************************************************************************************
** Function name: _post_setup_gpio()
** Location: main.cpp
** Description:   second stage gpio setup to make a few functions work
***************************************************************************************/
void _post_setup_gpio() {
#ifdef TFT_BL
    if (TFT_BL >= 0) pinMode(TFT_BL, OUTPUT);
#endif
    // The saved config file ("rot" field) overrides the compile-time ROTATION,
    // so changing -DROTATION alone left this upside-down panel unchanged.
    // Pin the runtime rotation to ROTATION after the config has been loaded
    // and begin_tft() has run (rotation 1 <-> 3 are 180 deg apart).
    bruceConfigPins.rotation = ROTATION;
    tft.setRotation(ROTATION);

    // begin_tft() already applied the loaded colorInverted; this panel shows
    // inverted colours with the generic default, so pin it to non-inverted
    // even if an old saved config said otherwise.
    bruceConfig.colorInverted = 0;
    tft.invertDisplay(0);
}

/***************************************************************************************
** Function name: getBattery()
** location: display.cpp
** Description:   Delivers the battery value from 1-100
***************************************************************************************/
int getBattery() { return 0; }

/***************************************************************************************
** Function name: isCharging()
** Description:   Default implementation that returns false
***************************************************************************************/
bool isCharging() { return false; }

/*********************************************************************
** Function: setBrightness
** location: settings.cpp
** set brightness value
**********************************************************************/
void _setBrightness(uint8_t brightval) {
#ifdef TFT_BL
    if (TFT_BL < 0) return;
    pinMode(TFT_BL, OUTPUT);
    if (brightval == 0) {
        digitalWrite(TFT_BL, LOW);
    } else {
        digitalWrite(TFT_BL, HIGH);
    }
#endif
}

/*********************************************************************
** Function: InputHandler
** Handles the variables PrevPress, NextPress, SelPress, AnyKeyPress and EscPress
**
** KEY_A -> SELECT (confirm)
** KEY_B -> ESC/BACK
**********************************************************************/
void InputHandler(void) {
    static unsigned long tm = 0;
    static unsigned long esc_tm = 0;
    static bool esc_armed = false;
    if (!(millis() - tm > 200 || LongPress)) return;

    bool u = digitalRead(UP_BTN);
    bool d = digitalRead(DW_BTN);
    bool l = digitalRead(L_BTN);
    bool r = digitalRead(R_BTN);
    bool s = digitalRead(SEL_BTN);
    bool b = digitalRead(ESC_BTN);

    if (!s || !u || !d || !r || !l || !b) {
        tm = millis();
        if (!wakeUpScreen()) AnyKeyPress = true;
        else return;
    }

    // KEY_B -> BACK / ESC
    if (!b) {
        EscPress = true;
        return;
    }

    // A + LEFT combo also works as BACK (keeps the 5-button habit)
    if (!l && !s) {
        EscPress = true;
        return;
    }

    // Long-press LEFT as BACK (like Marauder-Mini)
    if (!l) {
        PrevPress = true;
        if (esc_armed == false) {
            esc_tm = millis();
            esc_armed = true;
        }
    }
    if (esc_armed && millis() - esc_tm > 1000) {
        esc_armed = false;
        esc_tm = millis();
        PrevPress = false;
        EscPress = true;
    }
    if (!r) NextPress = true;
    if (!u) {
        UpPress = true;
        PrevPagePress = true;
    }
    if (!d) {
        DownPress = true;
        NextPagePress = true;
    }
    if (!s) SelPress = true;
}

/*********************************************************************
** Function: powerOff
** location: mykeyboard.cpp
** Turns off the device (or try to)
**********************************************************************/
void powerOff() {}

/*********************************************************************
** Function: checkReboot
** location: mykeyboard.cpp
** Btn logic to turn off the device (name is odd btw)
**********************************************************************/
void checkReboot() {}
