# Codex Workspace

This repository contains two local projects:

- `apps/agentic-pipelines`: shadcn/Vite UI simulator for workflow orchestration.
- `games/autonomous-devops-agent`: TypeScript autonomous DevOps agent with chat-triggered execution.

## Agentic Pipelines UI

Run locally:

```bash
cd apps/agentic-pipelines
npm install
npm run dev
```

Quality checks:

```bash
cd apps/agentic-pipelines
npm run lint
npm run test
```

## Autonomous DevOps Agent

### What it does

- Accepts chat commands to trigger Jira issue or GitHub PR work.
- Executes an agent workflow (generate, test, publish, deploy, scan, notify).
- Streams run/task events in real-time in the chat session.
- In `live` mode, sends real HTTP requests to Jira, GitHub, Harness, and ServiceNow.
- In `dry-run` mode, uses in-memory integrations for safe local iteration.

### Quick start (dry-run)

```bash
cd games/autonomous-devops-agent
npm install
npm run chat
```

Then try:

```text
help
run jira DEV-101
run pr acme/platform-service#12
status
events
```

### Live mode setup

1. Copy and edit environment variables:

```bash
cd games/autonomous-devops-agent
cp .env.example .env
```

2. Export the variables (or use your preferred `.env` loader) and run:

```bash
set -a
source .env
set +a
npm run chat
```

Required in live mode:

- `JIRA_BASE_URL` and Jira auth (`JIRA_BEARER_TOKEN` or `JIRA_EMAIL` + `JIRA_API_TOKEN`)
- `GITHUB_TOKEN`
- `HARNESS_API_KEY`, `HARNESS_PUBLISH_URL`, `HARNESS_DEPLOY_URL`, `HARNESS_SCAN_URL`

Optional but supported:

- `SERVICENOW_*` settings for posting run work notes

Harness endpoint contract used by this agent:

- `HARNESS_PUBLISH_URL` receives `{ "action": "publish", "repo": "...", "buildOutput": "..." }`
- `HARNESS_DEPLOY_URL` receives `{ "action": "deploy", "environment": "dev|prod", "artifact": "..." }`
- `HARNESS_SCAN_URL` receives `{ "action": "scan", "artifact": "..." }`
- Response can include `pipelineExecutionId`, `executionId`, `runId`, or `id` (any one is accepted)
- Scan response should include findings as `{ "critical": 0, "high": 0, "medium": 0, "low": 0 }` or under `findings`

### Chat commands

- `run jira DEV-123`
- `run pr owner/repo#42`
- `snow INC0012345`
- `status`
- `events`
- `help`
- `exit`

### Development checks

```bash
cd games/autonomous-devops-agent
npm run lint
npm run test
```
