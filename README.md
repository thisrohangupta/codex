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

### Capabilities

- Chat-triggered orchestration (`run jira ...`, `run pr ...`)
- OAuth bootstrap for GitHub and Jira (`auth github`, `auth jira`)
- Event streaming for task/run lifecycle
- Real API integrations for Jira, GitHub, Harness, ServiceNow
- Optional local command execution for build/test/deploy/validate against Kubernetes

### Quick start (dry-run)

```bash
cd games/autonomous-devops-agent
npm install
npm run chat
```

Try:

```text
help
run jira DEV-101
events
status
```

### Live mode setup

1. Configure environment variables:

```bash
cd games/autonomous-devops-agent
cp .env.example .env
```

2. Load env vars and start chat:

```bash
set -a
source .env
set +a
npm run chat
```

### OAuth setup from chat

Use these commands inside chat:

- `auth github`
- `auth jira`
- `auth status`

Flow:

1. Agent prints an authorization URL.
2. Open the URL, approve access.
3. Paste the redirected callback URL (or code) back into chat.
4. Access token is exchanged and saved to `OAUTH_TOKEN_STORE_PATH` (default: `.agent/oauth-tokens.json`).

Live mode automatically reuses stored OAuth tokens for subsequent Jira/GitHub API calls.

### Triggering build, test, deploy, and Kubernetes validation

Set `EXECUTOR_ENABLED=true` and configure command hooks in `.env`:

- `EXECUTOR_WORKDIR`
- `BUILD_COMMAND`
- `TEST_COMMAND`
- `DEPLOY_DEV_COMMAND`
- `DEPLOY_PROD_COMMAND`
- `VALIDATE_DEV_COMMAND`
- `VALIDATE_PROD_COMMAND`

Then run from chat:

- `run jira DEV-123`
- `run pr owner/repo#42`

When executor is enabled, each run executes:

1. LLM generation + baseline checks
2. `BUILD_COMMAND`
3. `TEST_COMMAND`
4. PR creation/comment sync (GitHub)
5. Artifact publish + scan + deploy orchestration (Harness if configured)
6. `DEPLOY_*_COMMAND` and `VALIDATE_*_COMMAND` for Kubernetes rollout/health validation
7. Notifications back to Jira/GitHub/ServiceNow

### Harness endpoint contract

- `HARNESS_PUBLISH_URL` request: `{ "action": "publish", "repo": "...", "buildOutput": "..." }`
- `HARNESS_DEPLOY_URL` request: `{ "action": "deploy", "environment": "dev|prod", "artifact": "..." }`
- `HARNESS_SCAN_URL` request: `{ "action": "scan", "artifact": "..." }`
- Accepted response run ID keys: `pipelineExecutionId`, `executionId`, `runId`, or `id`
- Scan response: `{ "critical": 0, "high": 0, "medium": 0, "low": 0 }` (or under `findings`)

### Chat commands

- `run jira DEV-123`
- `run pr owner/repo#42`
- `snow INC0012345`
- `auth github`
- `auth jira`
- `auth status`
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

## Secret scanning pre-commit hook (gitleaks)

Install and enable repo hooks:

```bash
cd /Users/rohangupta/code/codex
bash scripts/install-git-hooks.sh
```

What this does:

- Configures `core.hooksPath=.githooks` for this repo.
- Runs `gitleaks` on staged changes before every commit.
- Blocks commit if gitleaks is missing or if leaks are detected.

Recommended local secret file pattern:

- Put secrets in `*.local` env files (for example: `.env.secrets.local`).
- These are already ignored by git (`.env.*.local`) and will not be committed.
- OAuth token cache is also ignored via `.agent/`.

Manual verification:

```bash
git config --get core.hooksPath
git check-ignore -v games/autonomous-devops-agent/.env.secrets.local games/autonomous-devops-agent/.agent/oauth-tokens.json
```
