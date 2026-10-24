# Cloud-native selection

Provider credentials are recorded with their permission level before any scan; read-only engagements skip exploitation tooling. Prefer JSON output and provider-native verification of scanner findings.

| Scenario | Tool chain | Notes |
| --- | --- | --- |
| Multi-cloud posture | ScoutSuite-class inventory reports | Provider-native CLIs when one service is in scope |
| AWS compliance audit | prowler-class | ScoutSuite-class for broader inventory |
| Kubernetes CIS benchmark | kube-bench-class | Node or cluster access required |
| Kubernetes posture/RBAC | kubescape-class frameworks (NSA, MITRE) | trivy config for IaC-only quick checks |
| Docker host baseline | docker-bench-security-class | Host access required |
| Registry/API exposure | skopeo-class + curl probes | Exposed Docker API (2375/2376) is an escape finding |
| Image/filesystem scanning | trivy-class image/fs | See vulnerability guide |
| Azure attack paths | azurehound-class collection | Graph analysis via operator-supported BloodHound |
| AWS exploitation | pacu-class | Full-pentest authorization only |
| In-cluster exploitation | peirates-class | Explicit authorization; active service-account abuse |

Decision points: pod access gained — privilege escalation and container escape follow post-exploitation; exposed registry without authentication — enumerate tags, pull representative images, scan for secrets and CVEs; cluster CLI (kubectl-class) available — auth can-i matrices and cluster-admin binding checks before any workload inspection.
