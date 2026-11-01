# Password attack selection

Lockout policy is established before any online attack; offline work runs to the agreed time budget. Record command lines, wordlists, rules and the source of cracked material as evidence.

| Scenario | Tool chain | Notes |
| --- | --- | --- |
| Hash identification | hashid-class with mode numbers | Source context disambiguates candidates |
| GPU cracking | hashcat | Verify GPU availability first; save potfile context |
| CPU cracking | john | Formats via --format; *2john extractors for encrypted files |
| Online brute force | hydra-class | crowbar-class for RDP; medusa/patator-class alternatives when hydra-class fails on a protocol |
| Multi-protocol sweeps | netexec-class | Default and known credentials across SMB/WinRM/SSH/MSSQL/LDAP |
| AD enumeration and spraying | kerbrute-class userenum/passwordspray | Check the domain lockout policy before spraying |
| Hash capture | responder-class, analyze mode first | Poisoning needs explicit approval and internal scope |
| Wordlist generation | cewl-class target-derived; crunch-class rule-based | Deep-only for large generated lists |
| Archive/file cracking | per-format crackers (zip, pdf, rar-class) | Extract hashes first |

Choose a method from verified encryption or hash parameters, known plaintext, password clues, available hardware and the remaining budget. Dictionaries, rules, masks and hybrids are alternatives, not mandatory stages. Check existing results before repeating work. For ZipCrypto with sufficient known plaintext, consider a specialized known-plaintext method directly; this does not apply to WinZip AES. Validate a recovered archive with decryption and integrity checks. Before using a rainbow table, match its algorithm, salt assumptions, charset, lengths and table format; load only the selected compatible resource. An exhausted search establishes coverage of its candidates, not that the password cannot be recovered. Consult the catalog for the actual supported execution path before running a tool.
