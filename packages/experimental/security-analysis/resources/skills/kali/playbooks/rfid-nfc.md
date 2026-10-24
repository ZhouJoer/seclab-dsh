# RFID/NFC and hardware access playbook

Use for authorized RFID/NFC, Proxmark3, PC/SC smart-card, physical credential, embedded device and USB security assessment with operator-provided hardware in the selected environment.

## Inputs

Authorized card/token types, reader hardware, physical location and custody rules; allowed actions (identify, read, dump, key test, emulate, clone, write, APDU testing); safety limits for writes and destructive tests; whether firmware extraction or USB assessment is in scope.

## Environment

Reader and adapter hardware is passed through by the operator; containers without verified device access do not support this playbook. Default to read-only actions until explicit approval covers anything stronger.

## Workflow

1. **Reader and card inventory.** Identify readers, card type, UID/ATR, frequency and protocol with proxmark3-class or libnfc/PC/SC tooling.
2. **Read-only collection.** Public metadata, certificates, ATR, tag types and approved dumps, preserved with command logs and custody notes.
3. **Card type identification and strategy.** MIFARE Classic (default-key check across all sectors, then darkside/nested key recovery only if authorized); HID iCLASS standard key testing; DESFire/EV1 read-only enumeration; LF EM4100/T5577 identification with cloning assessment only if authorized. Decision order: card identified (retry with auto detection), default keys (full dictionary, every sector), then in-scope key recovery, then authorized write/clone phases.
4. **Controlled testing.** Key checks, APDU scripts, emulation, cloning or writes only under explicit authorization; stop immediately on card errors, unexpected state changes or reader instability. Test default keys against every identified card type, not only the first card found. Smart-card certificate and key enumeration through PC/SC tooling where authorized.
5. **Evidence handling.** Dumps, keys, certificates and identifiers are sensitive evidence; report for each item whether it was read, derived, cloned or written.
6. **Replay and cloning assessment.** With explicit write/clone authorization: replay captured data to a blank medium, document whether the access-control system detects duplicates, and stop at the first alert — detection capability is itself a positive finding.
7. **Firmware and embedded device testing.** Only when physical device access is in scope and authorized: identify UART/JTAG/SPI interfaces, extract firmware read-only, and search it for hardcoded credentials and certificates. Firmware binary analysis routes to security-native after its module is enabled. No flash writes or firmware modification without separate destructive-test authorization.
8. **USB/HID assessment.** Where in scope: document port controls, mass-storage restriction and HID filtering by observation. No USB attack payloads without dedicated authorization and tooling.

Tool selection: [../tools/rfid-nfc.md](../tools/rfid-nfc.md).

## Cross-references

wireless-assessment (Bluetooth proximity correlation), reporting-workflow; security-native/security-firmware for extracted firmware analysis after their modules are enabled.

## Expected evidence

Reader and card identifiers with protocol data; card-type classification and strategy notes; command logs, dumps and hashes with custody notes; replay/cloning results with detection assessment; firmware findings where in scope; explicit read/write/clone action records.

## Stop when

Authorized cards and tokens are identified and tested to the approved depth; further testing requires write, clone, emulation, destructive APDUs or out-of-scope credential handling; firmware and USB phases are complete or were not in scope.
