# OpenClaw + Autonomous DevOps Agent Merge Plan

## Scope & framing
- Objective: evolve `games/autonomous-devops-agent` into a day-to-day autonomous DevOps assistant with OpenClaw-style orchestration patterns.
- Timeframe: immediate architecture alignment + phased implementation over 4 milestones.
- Sources: OpenClaw official repo/docs and local code in this workspace.

## Facts from OpenClaw (primary sources)
- OpenClaw is structured as a local-first gateway that routes events from channels (GitHub, local CLI, REST) into agent sessions, with multi-session management and telemetry.
- OpenClaw separates responsibilities into packages: `gateway`, `agentloop`, `server`, `skills`, and channel adapters (`channel-github`, `channel-local`, `channel-rest`, etc.).
- `agentloop` is positioned as the core autonomous execution loop for long-running session behavior.
- `server` handles ingestion/persistence/telemetry and WebSocket management.
- `skills` are capability bundles with manifests and executable logic.
- `channel-rest` enables webhook-triggered flows and endpoint mapping with API-key auth.

## Current state of local agent (facts)
- Single runtime/agent pipeline with task events, Jira/GitHub/Harness/ServiceNow HTTP integrations, and OAuth bootstrap for Jira/GitHub.
- Chat loop is terminal-only and synchronous; no durable command queue, no autonomous daemon loop, no multi-agent router.
- Optional local executor can run build/test/deploy/validate shell commands (including Kubernetes commands) from configured hooks.

## Gap map (OpenClaw-style autonomy vs current agent)
- Channel architecture:
  - OpenClaw: multiple pluggable channels with session routing.
  - Local agent: direct chat + direct integrations, no channel abstraction.
- Session lifecycle:
  - OpenClaw: long-running autonomous sessions, loop orchestration.
  - Local agent: one command => one run.
- Skill/tool model:
  - OpenClaw: package-level skills and manifests.
  - Local agent: hardcoded pipeline steps.
- Queueing and scheduling:
  - OpenClaw docs emphasize command queue and cron-like scheduling.
  - Local agent: no durable queue/scheduler.
- State and memory:
  - OpenClaw server package centered on persistent ingest + telemetry.
  - Local agent: in-memory events only.

## Merge strategy
- Keep your existing domain-specific DevOps run engine (Jira/PR -> build/test/deploy/validate).
- Add OpenClaw-style orchestration shell around it:
  - Channel adapters -> route work into a session queue.
  - Session loop -> execute, observe, re-plan, notify.
  - Skill registry -> externalized task/action bundles.
  - Persistent event + command store.

## Milestone plan

### M1 (implemented now)
- Added `openclaw-adapter` HTTP server in this repo:
  - `GET /health`, `GET /runtime`, `POST /runtime/reload`, `GET /events`
  - `POST /runs/jira`, `POST /runs/pr`
- Purpose: let OpenClaw `channel-rest` trigger this DevOps agent as a downstream worker service.

### M2
- Add durable command queue:
  - persistent queue file or SQLite
  - states: queued/running/succeeded/failed/retryable
  - dequeue worker with concurrency + backoff.

### M3
- Add autonomous session loop:
  - heartbeats
  - interruption/resume
  - periodic context compaction + run memory snapshots.

### M4
- Add skill registry + policy layer:
  - skill manifests for build, test, deploy, rollback, incident triage
  - least-privilege policy per skill/channel
  - approval gates for production deploy and change records.

## Risk register (severity x likelihood)
- Credential sprawl and leakage (High x Medium)
  - Mitigation: continue OAuth store isolation, enforce gitleaks pre-commit, secret manager integration.
- Unsafe autonomous deploys (High x Medium)
  - Mitigation: policy engine + approvals + environment-scoped execution identities.
- Tool-command drift across repos (Medium x High)
  - Mitigation: per-repo executor profile, preflight checks, explicit non-zero fail-fast handling.
- Queue/state corruption on crashes (Medium x Medium)
  - Mitigation: append-only event log or SQLite transactions + idempotent run IDs.
- Rate-limit/API instability in Jira/GitHub/Harness/ServiceNow (Medium x Medium)
  - Mitigation: retries with jitter, dead-letter queue, circuit-breakers, observability.

## Tradeoff analysis
- Fastest path:
  - Use OpenClaw as orchestrator and this agent as a specialized REST worker.
  - Pros: immediate integration with minimal rewrites.
  - Cons: split observability unless unified telemetry later.
- Deep merge path:
  - Rebuild local runtime around OpenClaw package model (gateway/channel/skills/server).
  - Pros: long-term consistency with OpenClaw architecture.
  - Cons: larger refactor and migration cost.

## Open questions
- Should this repo become an OpenClaw skill pack, or remain an independent worker behind REST?
- Is deployment authority fully autonomous for prod, or always human-approved?
- Which K8s environments/clusters are in scope first (dev only vs dev+prod)?
- What SLA is expected for queue latency and incident-response triggers?

## Sources
- OpenClaw repo root: https://github.com/openclaw/openclaw
- OpenClaw README (raw): https://raw.githubusercontent.com/openclaw/openclaw/main/README.md
- OpenClaw gateway package: https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway/README.md
- OpenClaw agentloop package: https://raw.githubusercontent.com/openclaw/openclaw/main/packages/agentloop/README.md
- OpenClaw server package: https://raw.githubusercontent.com/openclaw/openclaw/main/packages/server/README.md
- OpenClaw skills package: https://raw.githubusercontent.com/openclaw/openclaw/main/packages/skills/README.md
- OpenClaw channel-rest package: https://raw.githubusercontent.com/openclaw/openclaw/main/packages/channel-rest/README.md
- OpenClaw channel-github package: https://raw.githubusercontent.com/openclaw/openclaw/main/packages/channel-github/README.md
- OpenClaw channel-local package: https://raw.githubusercontent.com/openclaw/openclaw/main/packages/channel-local/README.md
- Local runtime implementation: `/Users/rohangupta/code/codex/games/autonomous-devops-agent/src/runtime.ts`
- Local agent workflow: `/Users/rohangupta/code/codex/games/autonomous-devops-agent/src/agent.ts`
