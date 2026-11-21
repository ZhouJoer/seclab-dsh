---
kind: upgrade-guide
description: "安全工作台客户端从 followProjects() 读取项目列表，manageProject() 成功响应中的返回值为空。"
---

# 从目录订阅读取安全项目

[English](guide.md) | 中文

## 变更

安全工作台移除了 `projects()` Remote 方法。`followProjects()` 的首帧包含完整目录，包括已归档的项目。每一项的 `project` 字段就是原 JSON 列表中的项目。

Host 方法 `manageProject()` 返回 `Promise<void>`。Remote 客户端仍会收到成功或失败的结果。原先从成功响应中解析项目列表的客户端需要改为读取目录订阅。

## 迁移

1. 同时升级 Host 和客户端。将 `projects()` 替换为 `followProjects()`。如需一次性读取，从首帧取出 `frame.map(entry => entry.project)`，然后用 `break` 退出 `for await` 循环并关闭订阅。
2. 保留 `manageProject()` 的错误处理，删除对响应的 JSON 解析。持续显示目录的客户端可用每一帧替换当前列表。
3. 重命名或归档一个项目，确认目录订阅显示相应变更。恢复该项目后，同一订阅也应收到更新。
4. 如果 Host 扩展直接使用 `SecurityJournal`，把对 `replay(id, input)` 的真假判断改为 `hasCommitted(id, input)`。确认相同操作已提交或等待 `purge()` 成功后，如需快照，可调用 `view()`。以不同输入重用同一操作 ID 仍会抛出异常。
