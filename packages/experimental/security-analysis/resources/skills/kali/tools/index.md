# Tool selection guides

One guide per phase category, adapted for registered tools in operator-managed environments. Each guide routes to tool families; the exact invocation, structured-output preference and limits for a registered tool live in its catalog entry guide from security_capabilities, not here. Where a semantic adapter exists (security_radare2, security_jadx, security_tshark and peers), call the adapter instead of a shell equivalent.

| Phase | Guide |
| --- | --- |
| Discovery, OSINT, fingerprinting | [information-gathering.md](information-gathering.md) |
| Vulnerability scanning | [vulnerability.md](vulnerability.md) |
| Sniffing and spoofing | [sniffing-spoofing.md](sniffing-spoofing.md) |
| Web and API testing | [web.md](web.md) |
| Exploitation and pivoting | [exploitation.md](exploitation.md) |
| Password attacks | [password.md](password.md) |
| Wireless and Bluetooth | [wireless.md](wireless.md) |
| Cloud and containers | [cloud-native.md](cloud-native.md) |
| RFID/NFC and smart cards | [rfid-nfc.md](rfid-nfc.md) |
| VoIP and ICS/OT protocols | [voip-ics.md](voip-ics.md) |
| Binary and firmware analysis | [reverse-engineering.md](reverse-engineering.md) |
| Forensics | [forensics.md](forensics.md) |
| Post-exploitation | [post-exploitation.md](post-exploitation.md) |
| Reporting | [reporting.md](reporting.md) |

Binary and firmware analysis (reverse-engineering) and offline capture scripting run through their dedicated modules — reverse.android, reverse.native and iot — with their own registered skills; those guides only route to them.
