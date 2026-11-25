# LittleFS BLE remote implementation plan

**Goal:** Install a configurable Leshi V1 BLE remote extension on COM14 without a TF card, using the supplied production script and workbook as the packet references.

**Architecture:** Keep the application and editable packet list in LittleFS. Reuse the existing BJS raw advertising binding, adding nonconnectable mode and interpreter cleanup. Validate the existing work instead of replacing it. JSON configuration is preferred over hardcoded firmware commands (requires recompilation) and a standalone replacement firmware (would remove Bruce features).

**Tech stack:** Bruce BJS, NimBLE-Arduino 2.5, LittleFS, Python/pyserial, Node.js tests, GitHub Actions.

1. Read both user references and preserve the existing catalog change (line endings only). Compare exported commands to the workbook and encoded advertisements to actual production-script functions.
2. Make raw advertising explicitly nonconnectable; stop raw broadcasts on normal and exceptional interpreter exit. Validate raw AD boundaries and report failures.
3. Validate configuration before advertising, distinguish radio interval (20ms) from target hold interval (100ms), require A release before arming, stop on release/back/errors, maintain a shared packet counter, and use text that fits 160x128.
4. Add an installer for COM14 with capability check, local backups, readback hashes, and config-only updates. Use the existing /BruceJS root so other installed scripts stay visible.
5. Run codec differential tests, configuration boundary tests and mocked button/release/error tests. Build firmware in Actions and verify flash partitions against backup before writes.
6. Install into /BruceJS/lerc_remote, verify files and on-device interpreter startup. Test a bounded nonconnectable advertisement with an unrelated test ID if the host scanner is available; never run production/test/pairing commands automatically. Leave the remote idle for user testing and document any physical verification limits.

The user authorized implementation on COM14; do not request implementation approval again. Do not publish the user's local reference files or device backups.
