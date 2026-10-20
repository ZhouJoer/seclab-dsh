---
kind: upgrade-guide
description: "Job 等待默认值和安全进度 Remote 调整；已保存的工作台补丁优先于启动器默认值。"
---

# 安全工作台兼容性

[English](guide.md) | 中文

## 变更

源码安全启动器不再注入最高优先级的完整工作台配置。Bundle 默认值低于 profile、home 和显式 CLI 补丁。现有项目数据和工具文件保留。安全预设继续按活动返回并限制最多等待一分钟；其他组合默认等待完成，上限为十分钟。只读进度流接收 Session 身份，无需解析活动 Agent。

## 迁移

1. 检查 profile 和 home 的 `cordis.patch.yml` 中的 `security-workbench` 项。补丁会整体替换插件配置；设置预算、数据根或演进偏好时，请保留环境和其他必需字段。通过 `pnpm security --dump-config` 确认实际优先级。
2. 保留已有工具文件。自定义位置请显式设置 `toolConfiguration.path`。Bundle 默认优先使用工作区文件，否则继续使用已有的 Harness-home `security/tools.json`。通过 `environmentConfigurationPath` 选择环境 JSON 文件；仅应用其中的环境声明和可选接入默认值。
3. 需要按进度返回的自定义预设应设置 `tool-jobs.config.waitMode: activity` 和 `maxWaitTimeoutMs: 60000`。自带安全预设已包含这些设置。
4. 重新生成外部 Remote 客户端。`securityWorkbench/followSessionView` 的命名通信参数从 `agent` 改为 `sessionId`，按位置传递的标识不变。访问仍需取得该 Session 的授权。
5. 保留 helper 和 advisor 必读事件及所有历史 Session 代际。包版本相同不足以证明读取器兼容。每次合入上游后检查[补丁清单](../../../../scripts/security-compatibility.json)并运行 `pnpm run check:security-compatibility`。
