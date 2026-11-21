---
kind: upgrade-guide
description: "Security workbench clients read the project list from followProjects() and receive an empty success value from manageProject()."
---

# Read security projects from the directory stream

English | [中文](guide.zh.md)

## Change

The security workbench removes the `projects()` Remote method. The first `followProjects()` frame contains the full directory, including archived projects. Each entry's `project` field contains the project previously returned in the JSON list.

The Host method `manageProject()` returns `Promise<void>`. Remote clients still receive a success or failure result. Code that parses a project list from a successful response must switch to the directory stream.

## Migration

1. Upgrade the Host and clients together. Replace `projects()` with `followProjects()`. For a one-time read, take `frame.map(entry => entry.project)` from the first frame and break out of the `for await` loop to close the subscription.
2. Keep error handling for `manageProject()` and remove the JSON parsing of its response. A live directory can use each frame to replace its current list.
3. Rename or archive a project and verify that the subscribed directory shows the change. Restoring it should also update the same subscription.
4. If a Host extension uses `SecurityJournal` directly, replace truth checks on `replay(id, input)` with `hasCommitted(id, input)`. Both an exact retry and a successful `purge()` can be followed by `view()` when the extension needs a snapshot. Reusing an operation ID with different input still throws.
