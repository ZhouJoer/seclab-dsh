# Active Directory playbook

Use when Kerberos, LDAP, SMB, domain controllers, Windows domain names or AD credentials are in authorized scope.

## Inputs

Domain name, DC IPs, DNS server, known users, credentials or hashes if provided; authorized techniques (enumeration only, password audit, relay, AD CS testing, exploitation); lockout policy and allowed authentication rate.

## Workflow

1. **Identify AD signals.** Port profile 53/88/135/139/389/445/464/593/636/3268/3269/5985/5986 with version detection and scripts; confirm domain, DCs, DNS, SMB signing (a netexec-class --gen-relay-list sweep marks unsigned hosts as relay targets) and Kerberos time skew (within five minutes). With no DC found, verify SRV records (_ldap._tcp.dc._msdcs), broaden the subnet scan for 88/389/445, and check VLAN visibility before proceeding; do not continue to enumeration without a confirmed DC.
2. **Unauthenticated enumeration.** Null sessions, anonymous LDAP, shares, naming contexts and exposed users via enum4linux-ng, smbmap/smbclient and LDAP/Kerberos checks; username enumeration with a kerbrute-class tool (flagging AS-REP-roastable accounts). LLMNR/NBT-NS/mDNS exposure on the segment is recorded for the password-audit playbook's capture phase.
3. **Authenticated enumeration.** Users, groups, sessions, local admins, ACLs, SPNs, delegation, trusts and AD CS data via netexec-class collection, impacket-class tools, a bloodhound-python-class collector (the JSON collection is the engagement artifact; graph analysis needs an operator-supported BloodHound workflow, never a GUI launched from here), certipy-class AD CS enumeration (ESC1–ESC16), and ldeep-class deep LDAP queries for delegations, trusts and GPOs. Cross-check user counts between collectors; divergent counts are investigated before proceeding. Extract high-value indicators from collection JSON with structured queries: admin-count users, Kerberoastable (SPN) accounts, AS-REP-roastable accounts.
4. **Attack path analysis.** Prioritize shortest paths to Domain Admins, roastable users, local admin paths and AD CS escalation; validate high-impact paths manually before reporting.
5. **Credential and Kerberos testing.** AS-REP roasting and Kerberoasting hash extraction (impacket-class), spraying with lockout awareness — the password-audit playbook owns cracking, spraying and reuse. Crack all extracted hashes through its escalation ladder, not only the first few; test every cracked credential across all authorized services, then re-enumerate at the new privilege level — each credential unlocks different shares, ACLs and memberships.
6. **Coercion, relay and exploitation.** responder-class poisoning, coerced authentication, mitm6-class IPv6 MITM, ntlmrelayx-class relay including the AD CS HTTP endpoint, and AD CS abuse — each only with explicit approval, each with exact prerequisites and impact recorded.
7. **ACL and delegation abuse.** Where collection shows exploitable ACL paths, exercise the shortest, lowest-detection path with operator approval: WriteDACL, GenericAll/GenericWrite (targeted Kerberoasting via SPN writes, password resets), ForceChangePassword, AddMember. Delegation: unconstrained (monitor for incoming TGTs), constrained (S4U2Self/S4U2Proxy), RBCD (msDS-AllowedToActOnBehalfOfOtherIdentity configuration then service tickets).
8. **AD CS exploitation.** Beyond enumeration: ESC1-class misconfigured enrollment (request a certificate impersonating a privileged user, then authenticate with the PFX for the NT hash), ESC8 HTTP enrollment endpoints via NTLM relay. If a technique fails, walk the documented fallback chain (alternative coercion methods, ESC5–ESC11, GPO/LAPS/GMSA/delegation chains) and record each attempted-and-failed path.
9. **GPO and trust abuse.** cpassword extraction from SYSVOL policy XML; LAPS password attributes (v1 and v2) where the reading principal is authorized; GMSA managed-password reads; trust direction, transitivity and SID-filtering mapping. GPO modification and SID-history injection require explicit authorization and are usually documented as paths, not executed.
10. **Credential materialization.** With domain-admin-equivalent access and explicit per-action authorization: DCSync via secretsdump-class extraction, krbtgt-hash golden-ticket feasibility (documented, not minted, without separate authorization), shadow credentials via msDS-KeyCredentialLink, DPAPI backup-key and bulk secret extraction, remote LSASS extraction. Every materialized artifact records hash type, source host, account and method; hashes go to the password-audit playbook, and the engagement continues with the post-exploitation playbook.

Tool selection: [../tools/vulnerability.md](../tools/vulnerability.md) for enumeration, [../tools/password.md](../tools/password.md) for credentials, [../tools/post-exploitation.md](../tools/post-exploitation.md) for collection and abuse tools, [../tools/exploitation.md](../tools/exploitation.md) for relay and impacket-class paths.

## Cross-references

password-audit, post-exploitation, internal-network, cloud-native-assessment (Entra ID hybrid, Azure AD Connect), reporting-workflow.

## Expected evidence

Domain, DC, DNS and trust summary; user/group/computer/share inventory; collection JSON and high-risk paths; AD CS template findings; ACL and delegation abuse paths; GPO/LAPS/GMSA findings; credential evidence with lockout-safe notes; materialized credential inventory where authorized.

## Stop when

Collection, share, ACL and AD CS enumeration completed without errors or truncation for every authorized domain; extracted hashes cracked or exhausted through the agreed ladder; the credential-by-service matrix is fully populated; further progress requires spraying, relay, exploitation or execution beyond authorization; new domains or trusts require scope expansion.
