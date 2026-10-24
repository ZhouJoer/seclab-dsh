# VoIP and ICS/OT selection

Safety-first: every OT device carries a criticality classification before interaction, reads on safety-critical devices need OT-owner approval, and writes never happen in this category. Conservative timing against fragile devices; request rates within the authorized limits.

| Scenario | Tool chain | Notes |
| --- | --- | --- |
| Broad discovery first | nmap with ICS/VoIP NSE scripts, conservative timing | Before any protocol-specific tool |
| SIP service discovery | svmap-class | sippts-class scan as complement |
| SIP extension enumeration | svwar-class; sippts-class exten | Confirm lockout and PBX monitoring before volume |
| SIP credential testing | svcrack-class | Explicit approval; lockout policy applies |
| IAX enumeration | enumiax-class | UDP/4569 Asterisk targets |
| Voice VLAN discovery | voiphopper-class | Authorized local switch-port access required |
| Modbus read-only validation | modbus-cli-class reads (h@/i@) | Never issue writes (w@/c@) |
| PLC discovery | plcscan-class; s7-info/bacnet-info NSE | Prefer passive in fragile environments |
| RTP encryption check | tshark rtp filters on captures | SRTP versus plain RTP |
| IPMI/BMC | ipmitool-class; ipmi NSE scripts | Cipher zero and RAKP findings |
| SNMP | onesixtyone-class + snmpwalk-class | See vulnerability guide |
| Layer 2 testing | yersinia-class (CDP/DTP/STP) | Highly disruptive; isolated environments only |

Decision points: extension enumeration returns nothing — alternate methods (REGISTER versus OPTIONS) and check enumeration authentication; PLC answers discovery but reads fail — non-standard port or authentication, retry with explicit unit ID; fragile OT environment — passive discovery only, then read-only after OT-owner approval.
