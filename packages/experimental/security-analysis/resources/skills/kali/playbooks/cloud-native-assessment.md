# Cloud-native assessment playbook

Use for authorized cloud accounts, Kubernetes clusters, container images, registries, deployment manifests, serverless functions, CI/CD pipelines and Docker hosts.

## Inputs

Provider (AWS, Azure, GCP) with accounts/projects/subscriptions and regions; assessment mode (read-only audit, compliance-only, full pentest with exploitation); Kubernetes context, kubeconfig, namespaces, manifests or image lists; registry or Docker-host endpoints with allowed authentication; compliance baseline (CIS, SOC 2, PCI-DSS) and scan windows.

## Workflow

1. **Scope, access and provider identification.** Record the assessment boundary and the assessor identity (IAM user, assumed role, service principal, service-account key) with its permission level before any scan. Verify credentials with provider-native identity commands, then pick the primary chain: prowler-class compliance plus ScoutSuite-class inventory for breadth; exploitation-oriented tooling (pacu-class, peirates-class) only under full-pentest authorization. Read-only compliance engagements skip the exploitation phases; out-of-scope Kubernetes or containers skip their phases.
2. **IAM and identity assessment.** Enumerate users, roles, groups and policies; flag wildcard permissions, unconstrained role passing, wide trust assumptions and federation/OIDC over-privilege; check service-account and principal least-privilege and stale credentials. Iterate over every role, user and service account — policies of all of them, never a spot check. Kubernetes: ServiceAccount permission matrices (auth can-i), cluster-admin bindings. Credentials surfaced anywhere (SA keys, metadata tokens, environment secrets, bucket credentials) are tested against all discovered cloud services immediately, within scope.
3. **Cloud infrastructure security.** Audit security groups, NSGs and firewall rules for permissive ingress on management ports; enumerate storage and test ACLs and public-access blocks on every bucket/container; check public snapshots/images and unencrypted volumes; review audit-logging configuration. Cross-reference the internal-network playbook for authorized VPC-level testing.
4. **Kubernetes cluster security.** CIS benchmark checks (kube-bench-class), posture and RBAC analysis (kubescape-class), secrets in ConfigMaps and environment variables instead of Secret objects or vaults, network-policy coverage per namespace, pod security standards, privileged pods and added capabilities, hostPath mounts and docker.sock exposure. In-cluster exploitation of service accounts only with explicit authorization.
5. **Container and image security.** Scan images for OS and application vulnerabilities, embedded secrets and misconfigurations (trivy-class); audit the Docker host baseline where access exists; test registry authentication (anonymous pull, credential enumeration, overwrite permissions). Confirmed escape vectors route to the post-exploitation playbook when exploitation is authorized.
6. **Serverless and CI/CD.** Function execution roles, plaintext environment secrets and trigger sources across providers; pipeline configuration review for secret exposure, unpinned third-party actions, pull_request_target misuse and overly permissive OIDC trust; artifact signing and tamper resistance. IaC and pipeline files route to the source-code-audit playbook.
7. **IMDS and cloud metadata.** Test metadata-service reachability from containers, pods and VMs; IMDSv2 token enforcement; SSRF paths that could reach the endpoint. Harvested credentials document the access they grant and the missing enforcement — using them for lateral movement requires separate explicit authorization.
8. **Validation, segmentation and reporting.** Verify high-impact findings with provider-native commands to rule out scanner false positives; confirm production/non-production, management-plane and data-plane segmentation. A zero-finding posture report still gets manual confirmation of root-account MFA, audit logging, encryption at rest and console-access keys before acceptance. Organize findings: IAM and identity, infrastructure, Kubernetes, container and image, serverless and CI/CD, metadata — exploitation-proven first, confirmed misconfiguration next, informational last.

Tool selection: [../tools/cloud-native.md](../tools/cloud-native.md).

## Cross-references

internal-network (VPC testing), post-exploitation (container escape), source-code-audit (CI/CD and IaC), reporting-workflow.

## Expected evidence

Account/project inventory with credential scope; IAM enumeration with escalation paths; network and storage audit results; cluster benchmark and RBAC reports; image scan results; serverless and pipeline review; IMDS test evidence; categorized findings with remediation priorities.

## Stop when

All authorized accounts, clusters, images, registries, functions, pipelines and hosts are assessed; further progress requires write privileges, remediation or out-of-scope tenants; exploitation attempts are complete or not authorized and all findings are documented.
