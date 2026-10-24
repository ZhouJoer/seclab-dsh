# RFID/NFC selection

Hardware-dependent: Proxmark3, PC/SC readers and NFC adapters are operator-provided and passed through to the selected environment. Read-only by default; write, clone and emulation actions carry their own authorization. Dumps, keys and certificates are sensitive evidence with chain-of-custody notes.

| Scenario | Tool chain | Notes |
| --- | --- | --- |
| Card identification | proxmark3-class auto; nfc-list polling | Record UID/ATR, frequency, protocol |
| MIFARE Classic | default-key dictionary across all sectors; authorized darkside/nested recovery | Never clone or write without explicit approval |
| DESFire/EV1 | read-only enumeration | Encryption blocks key recovery; document the limit |
| LF identification | proxmark3-class LF search | Cloning assessment only if authorized |
| Smart-card inventory | opensc-tool-class listing; pcsc_scan | PC/SC reader access required |
| Certificates and keys | pkcs15-tool-class listing | Authorized reads only |
| APDU testing | scriptor-class exchanges | Malformed APDUs can affect cards; high caution |

Decision points: card unidentified — retry auto detection and NFC polling before concluding; default keys fail — key-recovery attacks only within the authorized technique list; replay/cloning impact — testing duplicate detection is part of the assessment and stops at the first alert.
