---
kind: upgrade-guide
description: "Security tool checks are read-only, and Python and toolbox setup require reviewed installation plans."
---

# Review security tool installations before applying them

English | [中文](guide.zh.md)

## Change

Toolbox checks no longer save discovered paths or start managed Docker containers. Existing executable selections remain readable. Saving a detected installation and starting its environment are separate operator actions.

`pnpm security:python` previously created an environment and saved its interpreter immediately. It now prints an installation plan. The environment lives under an explicitly selected shared installation directory. `pnpm security:toolbox` also prints a plan; it requires `--environment`, accepts a Kali package `--group`, and no longer accepts `--tag` or directly builds the benchmark image.

The independent version-1 installation ledger lives at `$DSH_HOME/security/tool-installations`. It retains the root, reviewed plans, operations and installation receipts across projects. Existing `.dsh/security-tools.json` selections are not automatically imported as managed installations. New pins may include `temporaryDirectory` for tools needing an owned runtime directory; keep that directory with the installation. Session log formats are unchanged.

## Migration

1. In **Toolbox**, check tools, then choose **Use this installation** to save a discovered candidate. For a stopped managed container, choose **Start environment** before checking. External containers still require operator-managed startup. Explicit **Check and save** and CLI `--save` remain available.
2. Select **Install and maintain tools → Shared installation directory**, or run `pnpm security:tools install-root "ABSOLUTE_DIRECTORY"`. Changing the root affects future installs; it does not move existing tools.
3. For Python, run `pnpm security:python --python "ABSOLUTE_PYTHON_PATH"` with a standalone 64-bit Python 3.12–3.14. For Kali, run `pnpm security:toolbox --environment ID --group kali-web`; available groups also include `kali-reverse`, `kali-firmware` and `kali-network`. Benchmark images still need their separate build dependencies and differential helper.
4. Managed Kali preview can download its base and run a temporary owned container without upgrading the selected environment. Review the printed sources, checksums, destination and steps. Run `pnpm security:tools install-apply PLAN_ID --digest DIGEST --request-id UNIQUE_ID`, adding required `--confirm ID` values. Existing external Kali containers require `--confirm external-container`; DSH does not take over their lifecycle. Necessary system components require their own explicit confirmation.
5. Inspect **Installation history** or `pnpm security:tools install-status`. A completed operation saves verified selections. `installed-unbound` retains installed files when selection publication fails; reconcile the recorded operation before retrying. Do not manually delete installations referenced by other projects. See the [workbench guide](../../../user/guide/security-analysis.md) for recovery and cleanup commands.
