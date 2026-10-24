# Mobile application playbook

Use for authorized Android APKs, iOS IPAs, mobile API clients and mobile runtime testing. Static APK/JVM analysis of imported assets belongs to security-android (reverse.android module); this playbook owns the mobile-security workflow across static review, storage, network, runtime and backend.

## Inputs

APK/IPA files, package identifiers, app version, test accounts and backend scope; device or emulator type, root/jailbreak state, instrumentation approval and SSL-pinning rules; allowed runtime hooks, data-extraction limits and whether backend API testing is in scope.

## Workflow

1. **Scope and environment.** Confirm app ownership, allowed devices, accounts and runtime instrumentation approval; record app hash, version, signing data and device state. Acquire the binary from provided files or an authorized device.
2. **Static analysis.** Manifest and resource decoding plus source-level review: endpoints, secrets, debug flags, exported components, permission declarations, deeplinks, crypto use and storage paths. Check every exported activity, service, receiver and provider (explicit exported flags and intent-filter defaults per platform version) — the complete attack surface, not the first finding. iOS: Info.plist URL schemes and ATS exceptions, entitlements, linked libraries, class and symbol inspection. Binary-level decompilation routes to security-android (APK/JVM) after its module is enabled.
3. **Data storage security.** Audit every storage location per platform — Android SharedPreferences, SQLite, internal and external storage, backups and logs; iOS NSUserDefaults, Keychain, plists, CoreData and caches — each recorded as contains-sensitive-data, clean or inaccessible. Check clipboard leakage and log output for sensitive patterns; verify background masking for screenshots and the task switcher.
4. **Network security.** Intercept mobile traffic through a configured proxy on the test host with the device proxy and CA installed; bypass certificate pinning through runtime tooling under the approved plan. Detect cleartext traffic (manifest flag, HTTP URLs in code) and weakened WebView SSL handling (custom TrustManagers, swallowed SSL errors). Intercept and test every backend endpoint the app communicates with, not only the first few; authentication, authorization and input validation per endpoint.
5. **Runtime instrumentation.** Frida-class hooks and objection-class exploration on authorized devices and apps only: activity/service listing, root and jailbreak detection bypass, targeted class and method watches with argument and return capture; IPC testing via deeplinks, intents, content providers and URL schemes.
6. **Binary protection assessment.** Obfuscation level (single-letter class/method names), repackaging detection, FairPlay encryption and symbol stripping, anti-debugging presence; assess detection-bypass effectiveness rather than assuming protections work.
7. **Backend and reporting.** Build the endpoint inventory from static strings and intercepted traffic; hand backend testing to the api-security and web-application playbooks. Consolidate findings by OWASP MASTG category with reproduction steps, affected versions and evidence.

Tool selection: [../tools/reverse-engineering.md](../tools/reverse-engineering.md) for adapter-routed binary queries; device work follows the existing android provider guides registered with the environment.

## Cross-references

api-security, web-application, reporting-workflow; security-android (imported APK/JVM analysis, reverse.android module).

## Expected evidence

App hashes, versions and device state; static findings with file/class references; storage audit per location; intercepted traffic with pinning-bypass evidence; runtime hook commands and IPC results; protection assessment; endpoint inventory.

## Stop when

Static analysis covered manifest/plist, secret search, exported components and protections; runtime checks covered storage, interception with pinning bypass, IPC and detection bypass; backend endpoints are inventoried and handed off; further testing requires bypassing controls, extracting user data or attacking out-of-scope backends.
