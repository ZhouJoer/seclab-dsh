# Binary and firmware analysis routing

Binary analysis is not part of this skill's toolset. It runs through the dedicated reverse modules with their own registered skills, adapters and evidence workflows; enabling those modules is the operator's decision, and loading this skill does not unlock them.

| Question | Route |
| --- | --- |
| APK, DEX, JAR composition, manifest, decompilation, call chains | security-android (reverse.android module): security_apk inventory, security_jadx manifest/decompile/callgraph, security_analysis android operations |
| PE, ELF, shared libraries, firmware native components | security-native (reverse.native module): security_radare2 metadata/functions/xrefs/disassembly, security_r2ghidra decompile, security_analysis native operations |
| Firmware images and extracted filesystems | security-firmware guidance under reverse.native |
| Bounded native-process observation | security-dynamic (reverse.native module) through approved Frida plans |
| Offline packet captures and wireless protocols | security-packet-analysis (iot module) bundled scripts |

Kali-environment binary utilities (file identity, strings, readelf-class inspection) available inside the environment follow their catalog guides for quick triage only; any deeper disassembly, decompilation or cross-reference work belongs to the adapters above, with saved adapter evidence rather than loose shell output. Mobile-app runtime instrumentation (objection/frida-class helpers) follows the mobile-application playbook's authorization chain.
