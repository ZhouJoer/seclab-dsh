# Main-agent output delivery

This opt-in plugin caps each main-agent request in an explicitly configured workspace and installs Helper's bounded output recovery. Subagents keep their owning consultation's limits. `primaryMaxTokens` defaults to 32768; recovery uses `recoveryReasoningEffort: low` and `recoveryMaxTokens: 8192`. These are request limits, not a total research-token allowance.

Only a known output-limit stop or a completed empty answer can request one new delivery turn. Recovery has no tools and reports established findings, unresolved work and the next check. The original incomplete turn remains in the log. Human input takes priority; network errors and unknown outcomes do not cause retries. A second incomplete delivery remains a failure. Later human tasks regain the ordinary effort and request limit.

Plugin removal awaits any owned recovery cancellation before releasing its tool guard. For a still-active Agent, the next ordinary request restores the limit recorded before this plugin applied its cap, provided a newer route or limit has not replaced it. Destroyed Agents receive no new callbacks. The original request headers remain unchanged.

The main-agent request cap can produce a partial progress report sooner than the provider's maximum. It does not guarantee a solved task or factual correctness. Provider-level verification must establish that the selected recovery effort reaches the configured route and is supported there. The shared Helper implementation owns recovery admission, durable messages, completed-answer validation and listener cleanup.
