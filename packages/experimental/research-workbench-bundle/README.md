---
description: "Compose independent file research and runtime tool panels."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-research-workbench-bundle

English | [中文](README.zh.md)

## Summary

Add a bottom research panel to an ordinary Web profile without requiring the security workbench. The bundle includes two independently disabled entries. Security-specific resource actions are supplied separately by research-security.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install `@deepseek-ai/dsh-experimental-research-workbench-bundle` into the profile and add it to `dsh.profile.bundles` after the base and Web application bundles, then launch `dsh --profile <name>`. The security source launcher includes the workspace development dependency automatically.

Use loader entry ids `research-workbench` and `research-runtime` for independent disable and configuration patches. Disabling runtime tools keeps file reading and editing. Disable the security adapter through its own `research-security` entry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

The [patch](cordis.patch.yml) composes the [research workbench](../research-workbench/README.md) and [runtime tools](../research-runtime/README.md). Packages share this repository and release version while retaining their own dependencies, configuration and tests. No Git submodule is required.

The interaction design draws on [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar). This implementation uses the native Cordis resource, slot, docking and terminal services; no upstream implementation source is copied.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Architecture](../../../docs/architecture.md)
- [Security workbench](../client-ui-security-analysis/README.md)

-----

<a id="dev-note"></a>
## Dev Note

None.

-----

<a id="model-experience"></a>
## Model Experience

### Operator research

#### What the model sees

Browsing creates no model request. `research.reference` inserts an attributed selection into the operator draft; explicit submission uses existing user-message logging.

#### Token effect

Only explicitly submitted quotations occupy conversation context; reading and editing add no model tokens.

#### KV Cache effect

The plugin does not change model tool definitions or system prompts. Submitted user messages follow the existing conversation path.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The experimental bundle targets the Web client. It does not include Git, a separate chat or independent release tooling.
