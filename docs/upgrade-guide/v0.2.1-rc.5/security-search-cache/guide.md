---
kind: upgrade-guide
description: "Security workbench search builds its full-text index in memory and retires the on-disk search cache."
---

# Retire the security workbench search cache

English | [中文](guide.zh.md)

## Change

Each search indexes the records visible to the caller in memory. Project edits no longer write a search database. After acquiring the security root lock, the Host removes an old `search.sqlite` only if its entire schema matches the former workbench index and it has no SQLite sidecar files.

## Migration

1. Remove `search.sqlite` from backup or monitoring jobs that expect the workbench to maintain it. Continue backing up the security journal and artifacts.
2. After upgrading the Host, search for a known record. If a `search.sqlite` file remains, review its ownership and any SQLite sidecars before deciding how to retain it. Previously quarantined `search.sqlite.corrupt-*` files may contain historical search data and can be reviewed separately.
