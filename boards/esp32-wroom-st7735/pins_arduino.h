#ifndef Pins_Arduino_h
#define Pins_Arduino_h

#include "soc/soc_caps.h"
#include <stdint.h>

/*
 * ESP32-WROOM (classic ESP32) + ST7735 160x128 TFT + TF (microSD) slot
 * =====================================================================
 * Screen (ST7735) - same wiring as the reference driver (参考驱动.txt):
 *   TFT_SCK   = 18   -> GPIO18 (SPI CLK, VSPI)
 *   TFT_MOSI  = 23   -> GPIO23 (SPI MOSI, VSPI)
 *   TFT_CS    =  5   -> GPIO5
 *   TFT_DC    =  4   -> GPIO4
 *   TFT_RST   = 19   -> GPIO19
 *   TFT_MISO  = 19   -> GPIO19 (VSPI MISO, shared with the TF card;
 *                               the ST7735 is write-only here)
 * TF (microSD) card - shares the same VSPI bus as the display:
 *   SDCARD_SCK   = 18 -> GPIO18
 *   SDCARD_MOSI  = 23 -> GPIO23
 *   SDCARD_MISO  = 19 -> GPIO19 (shared with TFT_RES, time-multiplexed)
 *   SDCARD_CS    = 22 -> GPIO22 (independent chip select)
 * I2C (per 引脚定义.txt):
 *   I2C_SCL = 15 -> GPIO15, I2C_SDA = 21 -> GPIO21
 * Buttons (active LOW, connect to GND):
 *   KEY_UP    =  2   -> GPIO2   (UP_BTN)
 *   KEY_DOWN  = 13   -> GPIO13  (DW_BTN)
 *   KEY_LEFT  = 27   -> GPIO27  (L_BTN)
 *   KEY_RIGHT = 35   -> GPIO35  (R_BTN)   <- input-only, needs external pull-up
 *   KEY_A     = 34   -> GPIO34  (SEL_BTN) <- input-only, needs external pull-up
 *   KEY_B     = 12   -> GPIO12  (ESC_BTN / BACK)
 *
 * WARNINGS:
 *   - GPIO34/GPIO35 are input-only on ESP32: INPUT_PULLUP does NOT work,
 *     you MUST add external 10k pull-up resistors to 3V3.
 *   - GPIO12 is the MTDI strap pin: if it is HIGH at boot the chip tries
 *     to run the flash at 1.8V and may fail to start. A button to GND is
 *     safe (it only pulls LOW while pressed); avoid an external pull-up
 *     to 3V3 on this pin.
 */

#define USB_VID 0x303a
#define USB_PID 0x1001

static const uint8_t TX = 1;
static const uint8_t RX = 3;

static const uint8_t TXD2 = 17;
static const uint8_t RXD2 = 16;

static const uint8_t SDA = 21;
static const uint8_t SCL = 15; // I2C SCL is GPIO15 (GPIO22 is SD CS)

// SPI defaults for classic ESP32 devkit
static const uint8_t SS = 5;
static const uint8_t MOSI = 23;
static const uint8_t MISO = 19;
static const uint8_t SCK = 18;

static const uint8_t G0 = 0;
static const uint8_t G1 = 1;
static const uint8_t G2 = 2;
static const uint8_t G3 = 3;
static const uint8_t G4 = 4;
static const uint8_t G5 = 5;
static const uint8_t G6 = 6;
static const uint8_t G7 = 7;
static const uint8_t G8 = 8;
static const uint8_t G9 = 9;
static const uint8_t G10 = 10;
static const uint8_t G11 = 11;
static const uint8_t G12 = 12;
static const uint8_t G13 = 13;
static const uint8_t G14 = 14;
static const uint8_t G15 = 15;
static const uint8_t G16 = 16;
static const uint8_t G17 = 17;
static const uint8_t G18 = 18;
static const uint8_t G19 = 19;
static const uint8_t G21 = 21;
static const uint8_t G22 = 22;
static const uint8_t G23 = 23;
static const uint8_t G25 = 25;
static const uint8_t G26 = 26;
static const uint8_t G27 = 27;
static const uint8_t G32 = 32;
static const uint8_t G33 = 33;
static const uint8_t G34 = 34;
static const uint8_t G35 = 35;
static const uint8_t G36 = 36;
static const uint8_t G39 = 39;

static const uint8_t ADC1 = 36;
static const uint8_t ADC2 = 34;

// ---- Buttons (Bruce 5-button model + a dedicated BACK button) ----
#define HAS_BTN 1
#define HAS_5_BUTTONS
#define UP_BTN 2    // KEY_UP
#define DW_BTN 13   // KEY_DOWN
#define L_BTN 27    // KEY_LEFT
#define R_BTN 35    // KEY_RIGHT  (input-only, external pull-up required)
#define SEL_BTN 34  // KEY_A      (input-only, external pull-up required)
#define ESC_BTN 12  // KEY_B -> BACK / ESC  (MTDI pin, button to GND only)
#define BTN_ALIAS "\"A\""
#define BTN_ACT LOW

#define TXLED -1
#define LED_ON HIGH
#define LED_OFF LOW

// BadUSB serial keyboard module (CH9329) - uses UART2 (TX=17, RX=16)
#define BAD_TX 17
#define BAD_RX 16

// SERIAL (GPS) dedicated pins - UART2
#define SERIAL_TX 17
#define SERIAL_RX 16
#define GPS_SERIAL_TX SERIAL_TX
#define GPS_SERIAL_RX SERIAL_RX

#define HAS_SCREEN 1
#define MINBRIGHT 80

// TF (microSD) card slot: shares the display's VSPI bus (18/23/19).
// GPIO19 is shared with TFT_RES (time-multiplexed). CS is GPIO22.
#define SDCARD_CS 22
#define SDCARD_SCK 18
#define SDCARD_MISO 19
#define SDCARD_MOSI 23

// No RF modules wired by default
#define CC1101_GDO0_PIN -1
#define CC1101_SS_PIN -1
#define CC1101_MOSI_PIN -1
#define CC1101_SCK_PIN -1
#define CC1101_MISO_PIN -1

#define NRF24_CE_PIN -1
#define NRF24_SS_PIN -1
#define NRF24_MOSI_PIN -1
#define NRF24_SCK_PIN -1
#define NRF24_MISO_PIN -1

// Shared SPI bus used by the TFT and the TF (microSD) card
#define SPI_SCK_PIN 18
#define SPI_MISO_PIN 19  // VSPI MISO, shared with the TF card
#define SPI_MOSI_PIN 23
#define SPI_SS_PIN 5

#define GROVE_SDA 21
#define GROVE_SCL 15

#define FP 1
#define FM 1
#define FG 2

#endif /* Pins_Arduino_h */
