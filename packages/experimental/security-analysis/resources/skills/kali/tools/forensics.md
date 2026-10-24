# Forensics selection

Read-only by default on verified working copies; chain-of-custody notes and hashes accompany every artifact. Captured calls are saved through security_capture_analysis with their input identity.

| Scenario | Tool chain | Notes |
| --- | --- | --- |
| Imaging with verification | dc3dd-class inline hashing; dcfldd-class; ddrescue-class for damaged media | Hash every working copy |
| File carving | foremost/scalpel-class signatures | testdisk-class for filesystem-level recovery |
| Bulk extraction | bulk-extractor-class | Emails, URLs, card numbers |
| Memory analysis | volatility-class with correct symbols | Processes, network, credentials, timelines |
| Unified timeline | plaso-class ingest then sort | fls/mactime-class for filesystem-only quick timelines |
| Metadata | exiftool-class | |
| Steganography | stegseek-class passphrase recovery; steghide extraction | |
| Windows event logs | chainsaw-class with Sigma rules | Event IDs 4624/4688/7045/1102 by question |
| Registry analysis | regripper-class per hive | SAM, SYSTEM, SOFTWARE, NTUSER.DAT |
| Malware triage | yara-class rules over extracted files | Community or engagement rule sets |
| Hash verification / similarity | hashdeep-class; ssdeep-class fuzzy matching | |
| Rootkit scanning | chkrootkit/rkhunter-class on mounted evidence | |
| Traffic analysis | tshark/tcpdump/tcpflow-class | Offline capture scripts: security-packet-analysis (iot module) |

Decision points: memory from an unknown OS — banner/symbol identification first, then string-level artifact extraction if unmatched; suspicious artifact — corroborate across at least one other evidence source before reporting; encrypted containers — route decryption to the password-audit playbook.
