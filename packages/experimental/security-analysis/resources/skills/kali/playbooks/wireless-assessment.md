# Wireless assessment playbook

Use for authorized Wi-Fi, Bluetooth and BLE testing with physical access and operator-provided hardware in the selected environment.

## Inputs

Authorized SSIDs/BSSIDs, Bluetooth device addresses, channels, physical location and test window; allowed techniques (passive capture, handshake capture, WPS testing, evil twin, deauthentication, BLE enumeration, BLE MITM); adapter model and monitor-mode/BLE support.

## Environment

Wireless and Bluetooth hardware is passed through by the operator; container environments without verified adapter access do not support monitor mode, injection or BLE work. Confirm local authorization before transmitting frames or interacting with nearby devices; deauthentication and rogue-AP techniques need explicit approval and an isolated test area.

## Workflow

1. **Adapter validation.** Interface inventory, driver and monitor-mode support, injection test; resolve interfering processes before enabling monitor mode. A missing capability is reported, never worked around by switching containers.
2. **Passive discovery.** Survey authorized SSIDs/BSSIDs, channels, encryption, clients and WPS state with airodump-ng-class or kismet-class tools, saving capture output as evidence.
3. **Capture.** Handshake or PMKID capture per authorized network — every network, tracked as captured, failed-with-reason or skipped, not just the first. Passive capture gets a reasonable wait before any escalation; deauthentication only with explicit authorization. Convert captures to cracker formats for phase 5.
4. **WPS testing.** Default-key checks, Pixie-Dust where the exchange supports it, then PIN brute force within lockout awareness — every WPS-enabled target tracked to recovered, attempted or locked-out.
5. **Cracking and validation.** Cracking through the password-audit playbook's ladder with agreed time budgets; WPA3/SAE networks are documented at their protection level with attention to transition-mode downgrade, not brute-forced by default. Never connect to a network unless connection itself is authorized.
6. **Advanced attacks (explicit approval, isolated environment).** Evil-twin and rogue-AP credential capture with client auto-association observation; WPA-Enterprise testing via rogue RADIUS accepting all identities, supplicant certificate-validation weaknesses and EAP credential capture (cracking captured LEAP material separately); KARMA-style probe-response attacks and client-isolation testing between associated clients.
7. **Bluetooth and BLE.** Discover and enumerate every in-scope device: advertising data leakage, GATT service and characteristic enumeration (unauthenticated reads/writes, notification channels), pairing-method assessment (Just Works, Passkey, Numeric Comparison) and connection-parameter review. Read/write interaction only against authorized devices.
8. **Post-authentication testing.** With authorized connection: confirm addressing and routing from the wireless segment, survey the segment's hosts and gateway services, and test wireless-to-wired segmentation (servers, printers, management interfaces, other VLANs). Then continue with the internal-network playbook from the wireless position.

Tool selection: [../tools/wireless.md](../tools/wireless.md); cracking through [../tools/password.md](../tools/password.md).

## Cross-references

internal-network (post-authentication assessment), password-audit (extended cracking), reporting-workflow.

## Expected evidence

Survey summary; capture files with validation; WPS results per target; rogue-AP and enterprise-test results where authorized; BLE device and GATT inventory; cracking logs; post-authentication reconnaissance and segmentation findings; hardware and location notes.

## Stop when

Authorized networks are surveyed and tested to the approved depth; further work requires deauthentication, evil twin, phishing, BLE MITM, device writes or credential use beyond authorization; the wireless segment is mapped and the internal-network playbook takes over.
