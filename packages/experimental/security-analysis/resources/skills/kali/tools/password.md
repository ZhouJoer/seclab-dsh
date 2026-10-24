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

Attack-mode decisions: fast hashes (NT, MD5, SHA-1) — dictionary with best64-class rules, then policy-matched masks, then hybrid; slow hashes (bcrypt, scrypt, Argon2) — short targeted wordlists with rules, masks when the policy is known, never exhaustive brute force; NetNTLMv2 — dictionary and rules only; Kerberos TGS — RC4 and AES modes per ticket type, dictionary first. When a dictionary plus rules exhausts, escalate masks → hybrid → prince-class piped generation before stopping. Mixed hash dumps separate by type and crack in parallel with correct modes.
