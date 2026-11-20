# Xueersi display and stability fixes Implementation Plan

**Goal:** Fix the reviewed display, memory and menu bugs, build the device firmware and flash COM14 with a recoverable flash backup.

**Architecture:** Keep changes limited to the existing Xueersi board and shared code containing confirmed bugs. Preserve valid saved orientation/inversion preferences, explicitly initialize board-specific panel offsets and RGB order, prevent invalid allocations and unbounded menu recursion, and reserve disjoint status-bar areas. Verify device identity before applying memory settings; a physical SD-reset wiring conflict cannot be solved by inventing a schematic.

**Tech Stack:** Classic ESP32, Arduino 3, PlatformIO, TFT_eSPI, esptool, Python regression checks.

## Steps

1. Inspect COM14 with esptool; record chip and Flash identity. Back up complete Flash before writes. Capture current boot logs if possible.
2. Board: enable verified classic-ESP32 PSRAM support, move UART defaults off GPIO16/17 if WROVER, sanitize legacy conflicting saved pins, preserve supported screen orientation and color preferences, synchronize final layout dimensions, cancel released long presses. Resolve shared reset/MISO initialization as far as supported by physical hardware; document remaining limitations.
3. Panel: honor TFT_RGB_ORDER for this driver, select RGB for the observed red/blue inversion, scope zero-offset calibration to the Xueersi panel and make all rotations deterministic.
4. UI: reserve the time area while fitting status icons; use actual font measurements for clock sizing. Fix green-channel storage/count/index mismatch.
5. Wi-Fi: replace recursive configuration refresh/back operations with loops/returns; guard WebUI allocations and AP initialization failure, preserve existing function scope.
6. Run targeted regression checks for color-channel enumeration, rotation offsets, status-bar layout, saved configuration migration, and nonrecursive menu navigation. Build firmware; resolve build failures without silently dropping requested fixes or unrelated features.
7. Verify binary sizes against actual Flash/partitions; write bootloader, partition table and application without erasing persistent storage unnecessarily. Capture post-flash boot logs and memory detection; record final artifact hashes and any remaining hardware-only verification.

User authorized implementation and COM14 flashing in this conversation. No further implementation approval is required.
