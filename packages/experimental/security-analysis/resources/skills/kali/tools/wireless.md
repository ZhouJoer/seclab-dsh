# Wireless selection

Hardware-dependent: monitor mode, injection and BLE need the operator-provided adapter in the selected environment. Deauthentication, rogue-AP and jamming-class techniques require explicit approval and an isolated area; disruptive tools (mdk4-class) are isolated-environment only.

| Scenario | Tool chain | Notes |
| --- | --- | --- |
| Adapter preparation | airmon-ng-class check/start with injection test | Resolve interfering processes first |
| Wi-Fi reconnaissance | airodump-ng-class; kismet-class for fully passive | Track every authorized network, not just the first |
| Handshake capture | airodump-ng-class targeted by channel/BSSID | Deauth only with explicit authorization |
| PMKID capture | hcxtools-class dump → convert to cracker format | No client required |
| Offline WPA cracking | aircrack-ng or hashcat mode 22000 | CPU fallback: john/cowpatty-class |
| WPS attacks | reaver-class (Pixie Dust via -K), bully-class fallback | WPS lockout ends the branch |
| Automated Wi-Fi testing | wifite-class batch; airgeddon-class stepwise | |
| Enterprise/evil twin | eaphammer-class, hostapd-mana-class, rogue-AP frameworks | Explicit authorization, isolated environment |
| LEAP cracking | asleap-class | Faster than generic modes for this format |
| Bluetooth enumeration | bluetoothctl, btscanner-class, sdptool-class | gatttool-class for BLE GATT work |
| BLE pairing analysis | crackle-class | Legacy vulnerable captures only |

Decision points: no clients and PMKID fails — wait for association; provoking reconnections is a disruptive technique needing authorization; WPS locked after attempts — fall back to handshake capture; handshake resists the standard dictionary — target-derived wordlists, hybrid, then policy-matched masks (password-audit ladder); multiple APs sharing an ESSID — lock by BSSID and channel.
