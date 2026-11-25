# Direct list remote and captured ON packet

User request: repair UP navigation, match the supplied 0AD3C5AB ON capture, and send with A directly in the list.

Use an application-owned paginated list with debounced GPIO reads. UP/DOWN select, LEFT/RIGHT move five items, A sends while held, B stops and exits. Keep the current selection during transmission, stop on release, and suppress the held launch button until release. Native dialog.choice would require a second modal page or repeated reopen; a firmware menu change would affect unrelated apps. Keep this change within the JS app.

Correct the manufacturer header's frame-length byte for arbitrary parameter counts. The production script's hardcoded 0E is valid only for its three-byte parameters. The user's five-byte ON capture independently establishes 10 and exact CRC/encryption. Set the first default item to that capture (ID 0AD3C5AB, group00, cmd00, params01AAAA0000, start ID01), retain reference production targets as an explicit override.

Verify the exact capture, all parameter lengths, original production frames, navigation wrap/debounce/repeat, hold/release/back/error behavior, GPIO pull-ups and screen bounds. Exercise the actual interpreter with simulated keys and generic BLE test AD, then deploy main.js/packets.json over COM14 with backups and byte readback hashes. Do not send product control commands automatically. Firmware remains unchanged.
