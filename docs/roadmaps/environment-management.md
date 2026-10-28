---
description: "Environment inventory, proposed management responsibilities and staged acceptance for security tooling."
---

# Security environment management plan

English | [中文](environment-management.zh.md)

## Summary

This plan covers shell runtimes, language runtimes, native and cross-compilation toolchains, and containers. Python provisioning is implemented by [`security:python`](../user/guide/security-analysis.md). General environment management below is proposed, not delivered. Reuse the existing security environment manager, tool catalog, installation settings and subprocess services; keep application startup in `dsh` profiles.

## Contents

- [Observed workstation](#inventory)
- [Management design](#design)
- [Delivery and acceptance](#acceptance)
- [Dev Note](#dev-note)

<a id="inventory"></a>
## Observed workstation

The Windows inspection on 2026-10-28 checked command resolution, known installation directories and bounded version queries. It was not a whole-disk search. A missing PATH entry does not prove software is absent. Installed compiler files do not prove a usable SDK, license or target sysroot.

| Family | Observation | Required treatment |
|---|---|---|
| Python | Independent 3.14.10 and isolated security dependencies work | Explicit base interpreter; pinned dependencies; verified configuration publication |
| PowerShell | System PowerShell 7.6.3, Windows PowerShell 5.1 and an application-cache candidate coexist | Record selected executable and edition; retain explicit `pwshPath` priority |
| Node and pnpm | Node 24.15.0 and pnpm 11.28.5 resolve; application-cache alternatives exist | Honor repository engines and package-manager version; report actual executable |
| Java | PATH selects Java 8; user `JAVA_HOME` selects Temurin 21; JADX owns Java 25 | Bind Java per consumer; detect disagreement without replacing unrelated installations |
| CMake and Ninja | PATH CMake is 3.26.0-rc1; Visual Studio contains CMake 4.3.1-msvc1 and Ninja 1.13.2 | Treat build tools and compiler environment as one selection |
| MSVC | Visual Studio installation and x86/x64 compiler files exist; x64 compiler reports 19.51.36260 | Resolve through Visual Studio discovery and developer environment; compile/link smoke still required |
| Embedded targets | No ARM GNU, RISC-V GNU or Android NDK compiler found in checked paths; old Android/Qt PATH entries point to absent directories | Keep unverified status; require target-specific registration and probes |
| Vendor tools | Gowin executable exists; checked Keil directory contains installation media | Do not infer installation, license or target readiness from directory names |
| Containers | Docker client/server report 29.7.2; no running containers reported; only Docker-managed WSL distribution listed | Separate engine, image, container and in-container tool health |

<a id="design"></a>
## Management design

Keep three distinct records: portable requirements committed to the repository; machine-local executable selections; measured health with timestamps. Requirements describe version constraints, supported host architectures, installation sources, probe operations and dependency relationships. Local selections contain absolute paths and launcher arguments. Measurements include executable identity, version, architecture, dependency results and diagnostics; they are observations, never installation declarations. Never commit credentials or workstation paths into portable requirements.

Use explicit request selection first, followed by workspace selection and deployment defaults. Discovery returns candidates; multiple compatible candidates require a saved choice. An invalid explicit selection fails visibly rather than falling back to another runtime. CLI, UI and actual execution must consume the same resolved specification. A future shared resolver must preserve current checkout/home precedence and explicit profile overrides, with a migration guide for any changed defaults.

Apply environment variables to the selected child process, without globally rewriting PATH. A Java selection supplies a matching `JAVA_HOME` and command path. MSVC uses the matching developer environment, SDK, compiler and linker. A cross-toolchain selection records host architecture, target triple, sysroot, ABI, compiler/linker versions and runtime libraries. Keep host compilation, target compilation and target execution separate; producing an ELF file does not establish device execution.

Keep discovery and health checks read-only. Provisioning is explicit and uses trusted sources, bounded subprocesses and fixed dependency versions. Install a new generation, verify it, then atomically publish its selection. Preserve the previous environment for rollback and active tasks. Garbage collection must refuse generations referenced by tasks; it is a separate explicit operation. Offline or unsupported targets report actionable failure without silently substituting tools.

<a id="acceptance"></a>
## Delivery and acceptance

1. Python: explicit standalone base, isolated dependencies, failure-preserving commit and CLI/profile configuration parity. Validate a fresh clone, repeated setup, installation failure, invalid interpreter and concurrent operator edits.
2. Read-only inventory: add shell, Node, Java and native-build probes to existing definitions. Display selection source and conflicts; verify that discovery changes no settings and starts no containers.
3. Consumer integration: pass a resolved environment to existing subprocess providers. Verify that shell commands and adapters observe the same selected runtime, including Java and MSVC environment variables.
4. Cross compilation: add only requested target families. Compile and link a minimal program, inspect target headers and record unresolved hardware or license requirements. Test with owner-local temporary directories and no physical device dependency.
5. Reproduction: exercise Windows, Linux and macOS where declared supported; test paths with spaces and Unicode, missing tools, stale paths, network failures and simultaneous setup. Use isolated homes and preserve the active environment on every failed preparation path.

<a id="dev-note"></a>
## Dev Note

This plan does not claim every runtime has a portable automatic installer. Vendor licensing, exact target families and offline package mirrors need operator requirements before implementation. Hash-locked installation archives and build dependencies are follow-up work; Python currently pins runtime dependency versions and verifies the installed environment.
