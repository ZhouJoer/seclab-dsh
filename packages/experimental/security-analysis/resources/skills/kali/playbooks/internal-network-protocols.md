# Internal network protocols

Protocol-specific testing for services routed here by the internal-network playbook per-service matrix. Apply that playbook's matrix and CVE evaluation procedure to every protocol below. Registered tools run through the selected environment via security_execute with saved raw output; capture committed calls with security_capture_analysis.

Tool selection: [../tools/vulnerability.md](../tools/vulnerability.md) for enumeration scanners, [../tools/password.md](../tools/password.md) for credential tests, [../tools/exploitation.md](../tools/exploitation.md) for authenticated execution paths.

## SMB

Anonymous and authenticated share enumeration with smbmap/smbclient-class tools and enum4linux-ng for comprehensive SMB/NetBIOS enumeration; nbtscan for NetBIOS names across the subnet; a netexec-class tool to check SMB signing (unsigned hosts are relay targets). Search accessible shares for sensitive material (keepass databases, config files, keys, certificates, memory images) and record findings with share paths.

## MSRPC

Enumerate RPC interfaces with an rpcdump-class tool; flag coercion-capable interfaces (MS-RPRN, MS-EFSR, MS-DFSNM, MS-SCMR) as relay-input findings for the active-directory playbook.

## SNMP

Test community strings from a common-strings list (onesixtyone-class), then walk system, host-resources, installed-software and user-account OIDs with snmpwalk. Default public/private strings are findings; record which OIDs disclosed sensitive data.

## Kerberos

User enumeration via the nmap krb5-enum-users script against the DC realm. All further Kerberos work belongs to the active-directory playbook.

## LDAP

ldap-rootdse and an anonymous ldapsearch bind test for naming contexts; enumerate person objects within the authorized base. Anonymous directory reads are findings.

## RDP

Encryption and NLA state via rdp-enum-encryption and rdp-ntlm-info scripts; a netexec-class tool for availability and OS info.

## WinRM

Availability and null-authentication checks with a netexec-class tool; with valid credentials use an interactive WinRM client (evil-winrm-class) only under an approved plan.

## SSH

Algorithm and authentication-method enumeration (ssh2-enum-algos, ssh-auth-methods). Weak algorithm sets and password authentication exposure are configuration findings.

## FTP

ftp-anon, ftp-syst and bounce checks via scripts, then verify anonymous access manually (scripts give false negatives on PASV quirks): recursive listing for backup and config material, a writable-directory probe by upload, both as saved evidence. Anonymous write access is a finding, not a place to store files.

## Databases

MySQL (mysql-enum, direct connection test distinguishing ACL from authentication errors), MSSQL (ms-sql-info; with credentials, an mssqlclient-class session to check sysadmin, xp_cmdshell and linked servers), PostgreSQL (connection test and version). Credential testing stays within the lockout policy.

## Mail

SMTP open-relay script check; user enumeration via VRFY/EXPN/RCPT (smtp-user-enum-class); relay and authentication behavior with a swaks-class client. Open relay is a high finding; verify with a controlled message to an authorized mailbox only.

## NFS

showmount export listing; mount only through an approved plan, read-only, and record exported shares reachable without restrictions.

## IPMI

ipmi-version script on UDP/623; with an ipmitool-class client check chassis status and the user list for default credentials; cipher-zero (unauthenticated access) and RAKP hash disclosure are critical findings. Hand hashes to the password-audit playbook.

## Redis / NoSQL

redis-info and redis-brute scripts; with redis-cli check unauthenticated PING, keyspace, requirepass, and writable dir/dbfilename configuration. Unauthenticated CONFIG access is exploitable (key injection, webshell, cron) — document the configuration state as the finding; exploitation needs its own approval. MongoDB exposure via mongodb-info/mongodb-databases.

## Unlisted services

For anything not above (VNC, Telnet, Elasticsearch, Java RMI, Oracle TNS), apply the per-service matrix: version detection and scripts, unauthenticated access, CVE applicability, default credentials; with database credentials, check for OS command execution capabilities.

## Cross-references

internal-network (parent playbook and matrix), active-directory (domain environments).
