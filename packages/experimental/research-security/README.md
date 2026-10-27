---
description: "Open immutable security materials and evidence in the independent research panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-research-security

English | [中文](README.zh.md)

## Summary

Use Preview in window or Add to comparison beside a material or evidence preview. Resources stay grouped by project identity. Disabling this adapter removes its actions while the original security preview remains available.

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

Enable `research-security` with the security workbench and research workbench in the same Web profile. It has no additional configuration or system executable dependency.

The security profile source launcher selects the research bundle. Historical materials open in a large draggable, resizable window, or fullscreen below 768px. They stay read-only and require no active conversation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

The security UI owns a single `security.resource.actions` Factory declaring `security.resource.actions.item`. This adapter contributes buttons through that slot and reads `projectMaterialDocument` or `projectArtifact`; the security UI imports no research implementation. See the [Client entry](src/client/index.tsx).

Material identity includes project, asset and relative snapshot path. Evidence identity includes project, evidence and artifact digest. Snapshot synchronization never replaces an already opened identity.

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

- Text retains the security preview limit; truncated text and binary documents cannot be complete diff inputs. PDF and raster images use snapshot bytes. Office files use the optional local Office-to-PDF service and its configured limits. Other binary files show a byte prefix.
