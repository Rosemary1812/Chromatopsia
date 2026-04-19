# Coding Agent Resume Gap TODO

## Confirmed Priorities

### 1. Task Recovery
- [ ] Wire `SessionManager.recover_or_prompt()` into the main startup/runtime path instead of always creating a fresh session.
- [ ] Support at least the safe path first: auto-recover when there is exactly one active session for the current working directory.
- [ ] Define what recovery means in the current system boundary:
  - [ ] restore message history
  - [ ] restore current session metadata
  - [ ] explicitly document non-goals for now, such as pending tool execution state / approval state replay
- [ ] Add tests that cover:
  - [ ] no active session -> create new
  - [ ] one active session -> recover automatically
  - [ ] multiple active sessions -> surface candidate selection path
- [ ] After this is shipped, update resume wording from "has recovery foundation" to "supports session recovery / interrupted-task continuation baseline".

### 2. Trace / Observability
- [ ] Add structured trace logging for each turn under `.chromatopsia/logs/`.
- [ ] Persist key events with stable IDs:
  - [ ] `turn_id`
  - [ ] `tool_call_id`
  - [ ] provider / model
  - [ ] tool start / end
  - [ ] approval requested / resolved
  - [ ] retries / timeout / truncation continuation
  - [ ] compaction trigger + metadata
- [ ] Define a machine-readable format first, e.g. JSONL per session or per turn.
- [ ] Make traces correlate across runtime events and persisted files.
- [ ] Add a minimal inspection command or script for reading traces during debugging.
- [ ] After this is shipped, resume wording can safely use "execution traceability" or "structured runtime tracing".

### 3. Prompt Caching
- [ ] Design which prompt segments are stable and should carry cache hints:
  - [ ] core system prompt
  - [ ] skill directory listing
  - [ ] selected memory index block
  - [ ] static project context
- [ ] Turn the existing `cache_control` field from reserved interface into an actually used strategy.
- [ ] Implement provider-aware cache tagging, starting with Anthropic where the SDK path already accepts `cache_control`.
- [ ] Decide fallback behavior for providers without prompt caching support.
- [ ] Add verification:
  - [ ] unit tests for tagged message construction
  - [ ] debug logs or trace fields showing cached vs non-cached segments
- [ ] After this is shipped, resume wording can explicitly mention prompt caching.

## Intentionally Not Written Into Resume Yet

### 4. Sandbox Isolation
- [ ] Do not describe current implementation as strong sandbox isolation.
- [ ] Current status is lightweight local safety controls:
  - [ ] workspace path constraints
  - [ ] denied-pattern checks
  - [ ] approval gate
  - [ ] timeout-based command control
- [ ] If later implemented, consider a stronger isolation direction such as `WalkTree`-based constrained execution / filesystem mediation.
- [ ] Only write "sandbox isolation" into the resume after the isolation boundary is materially stronger than host-shell guardrails.

### 5. Hallucination Suppression / Self-Critique
- [ ] Do not claim explicit self-critique yet.
- [ ] Current system has reliability guardrails, but no dedicated self-critique stage.
- [ ] If added later, design it as a lightweight conditional check before risky tool execution or after repeated failed tool rounds.

## Resume Writing Rules For Now
- [ ] Keep "task recovery" phrasing conservative until runtime wiring is complete.
- [ ] Use "observability" instead of "full traceability" until structured traces are persisted.
- [ ] Do not claim:
  - [ ] strong sandbox isolation
  - [ ] explicit self-critique
  - [ ] prompt caching already implemented
