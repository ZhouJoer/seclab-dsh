---
kind: upgrade-guide
description: "job_output 的默认等待上限从十分钟缩短为一分钟。"
---

# job_output 等待上限

[English](guide.md) | 中文

## 变更

`job_output(wait: true)` 会立即返回未读输出，并在有新的模型可见输出、进度变化或任务完成时唤醒。调用方须检查返回状态：读取成功不代表任务已经结束。超时结果明确说明后台任务仍在运行，并提示不要重复同样的等待。

`@deepseek-ai/dsh-tool-jobs` 的 `maxWaitTimeoutMs` 默认值从 `600000` 降为 `60000`。模型提交更大的 `timeout_ms` 时，最多等待一分钟就返回当前任务状态。任务继续运行，并保留完成通知。省略 `timeout_ms` 时的默认等待时间仍为 `30000`。

## 迁移

1. 交互式会话保留新默认值即可，无需修改配置。
2. 如果 profile 确实需要更长的单次等待，在其 `cordis.patch.yml` 的 `@deepseek-ai/dsh-tool-jobs` 条目上设置 `config.maxWaitTimeoutMs: 600000`。显式配置的 `waitTimeoutMs` 不得超过该上限。
3. 验证长时间运行的任务在配置的等待时间到期后返回 `[status: running]`，并且完成后仍可读取结果。已经开始的等待继续使用启动时捕获的配置。
