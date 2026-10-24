# Sniffing and spoofing selection

On-path attacks require explicit authorization and position on the target segment; every capture is saved raw with interpretation separate. Credentials and payloads observed in captures are sensitive evidence.

| Scenario | Tool chain | Notes |
| --- | --- | --- |
| ARP poisoning / MITM | bettercap-class | ettercap-class for simple flat-LAN ARP spoofing |
| Cleartext credential sniffing | dsniff-class | bettercap-class when SSL stripping is also needed |
| DNS spoofing | dnsspoof/bettercap-class | dnschef-class when only specific domains matter |
| Custom packet crafting | scapy-class | hping3-class for quick single-packet tests |
| Firewall/traceroute probing | hping3-class | scapy-class for multi-packet sequences |
| SSL stripping | bettercap-class caplets | HSTS-resisting clients limit impact; record honestly |
| Pattern search in traffic | ngrep-class | tshark display filters for protocol-aware extraction |

Decision points: 802.1X port authentication defeats ARP spoofing — do not force it, document the control; switched network without position — CAM overflow (macof-class) then sniff, or DNS-only interception; passive NTLM capture — responder-class LLMNR/NBT-NS poisoning is the right tool, not ARP spoofing; cross-VLAN interception — layer-2 techniques (yersinia-class) come first and need their own authorization. MAC randomization (macchanger-class) before scanning keeps host identity out of target logs.
