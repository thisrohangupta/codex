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
- Durable run queue + autonomous worker loop (OpenClaw-style behavior without OpenClaw install)
- Cron-based scheduled runs (Jira or PR targets) via scheduler daemon
- Policy gates for production deployment (`auto` vs `approval`)
- Multi-target deployment orchestration with source clone, deploy-config clone, binary download, and target-aware apply

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

### OpenClaw integration path

Run this agent as an OpenClaw-invokable REST worker:

```bash
cd games/autonomous-devops-agent
npm run adapter
```

Adapter routes:

- `GET /health`
- `GET /runtime`
- `POST /runtime/reload`
- `GET /events`
- `GET /queue`
- `GET /queue/{id}`
- `POST /queue/jira`
- `POST /queue/pr`
- `GET /approvals`
- `GET /approvals/{id}`
- `POST /approvals/{id}/approve`
- `POST /approvals/{id}/reject`
- `GET /schedules`
- `GET /schedules/{id}`
- `POST /schedules`
- `PATCH /schedules/{id}`
- `DELETE /schedules/{id}`
- `POST /schedules/{id}/run-now`
- `POST /runs/jira` with `{ "issueId": "DEV-123", "serviceNowRecordId": "INC0012345" }`
- `POST /runs/pr` with `{ "repo": "owner/repo", "prNumber": "42" }`
- `POST /probe/jira` with `{ "issueId": "DEV-123" }`
- `POST /probe/pr` with `{ "repo": "owner/repo", "prNumber": "42" }`

If `ADAPTER_ASYNC_QUEUE=true`, `POST /runs/*` also enqueue and return `202`.

### Standalone autonomous mode (no OpenClaw required)

Run adapter, worker, and scheduler in separate terminals:

```bash
cd games/autonomous-devops-agent
npm run adapter
```

```bash
cd games/autonomous-devops-agent
npm run worker
```

```bash
cd games/autonomous-devops-agent
npm run scheduler
```

### Browser UI end-to-end testing

Run the local Ops console in a fourth terminal:

```bash
cd games/autonomous-devops-agent
npm run dev
```

Open the printed Vite URL (typically `http://127.0.0.1:5173`), set adapter base URL to
`http://127.0.0.1:8790`, then test directly from the browser:

- Probe targets before execution (`Probe Targets` actions)
- Trigger immediate runs (`Run Now`)
- Queue work (`Queue`)
- Review and approve/reject policy gates (`Approvals` panel)
- Create/toggle/run-now/delete schedules (`Schedules` panel)

Queue a Jira run:

```bash
curl -X POST http://127.0.0.1:8790/queue/jira \\
  -H 'content-type: application/json' \\
  -d '{"issueId":"DEV-123","serviceNowRecordId":"INC0012345"}'
```

Inspect queue:

```bash
curl http://127.0.0.1:8790/queue
```

Create a cron schedule (every 30 minutes):

```bash
curl -X POST http://127.0.0.1:8790/schedules \
  -H 'content-type: application/json' \
  -d '{"name":"sync-dev-123","cron":"*/30 * * * *","type":"jira","issueId":"DEV-123"}'
```

Inspect schedules and approvals:

```bash
curl http://127.0.0.1:8790/schedules
curl http://127.0.0.1:8790/approvals
```

### Policy gates (auto vs human approval)

Set in `.env`:

- `DEPLOYMENT_POLICY_MODE=auto` to automatically continue to prod after checks
- `DEPLOYMENT_POLICY_MODE=approval` to pause before prod and require human approval

When policy mode is `approval`, run outcomes become `needs_review` with note
`Manual approval required for production deployment`. Approve and re-queue:

```bash
curl -X POST http://127.0.0.1:8790/approvals/<approval-id>/approve \
  -H 'content-type: application/json' \
  -d '{"approvedBy":"architect"}'
```

### Optional OpenClaw bridge

If you install OpenClaw, use `channel-rest` to route into this adapter.

- Starter template: `/Users/rohangupta/code/codex/games/autonomous-devops-agent/examples/openclaw-channel-rest.template.yaml`
- Adjust field names to your OpenClaw version/schema.

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

### Multi-target deployment support (Harness-style target families)

This agent can now orchestrate multiple deployment targets per run using:

- `EXECUTOR_CLONE_SOURCE` + `EXECUTOR_SOURCE_*` to clone code into an isolated workspace.
- `EXECUTOR_CLONE_DEPLOY_CONFIG` + `EXECUTOR_DEPLOY_CONFIG_*` to pull deployment config separately.
- `EXECUTOR_BINARY_*` to download a release artifact/binary.
- `EXECUTOR_DEPLOYMENT_TARGETS_JSON` for explicit target matrix.
- `EXECUTOR_AUTO_DETECT_TARGETS=true` to infer target type from repo layout when JSON is empty.

Supported target types:

- `kubernetes`, `helm`
- `aws-ecs`, `aws-asg`, `aws-lambda`, `aws-cloudformation`, `aws-codedeploy`, `aws-ami`, `aws-spot`
- `aks`, `azure-web-app`
- `gke`, `gcp-cloud-run`
- `serverless`, `ssh`, `winrm`, `custom`

Example target matrix:

```bash
export EXECUTOR_DEPLOYMENT_TARGETS_JSON='[
  {"name":"dev-k8s","type":"kubernetes","environments":["dev"],"manifestPath":"k8s/overlays/dev","namespace":"dev"},
  {"name":"prod-helm","type":"helm","environments":["prod"],"chartPath":"helm","valuesFile":"helm/values.prod.yaml","releaseName":"platform-service","namespace":"prod"},
  {"name":"prod-cloud-run","type":"gcp-cloud-run","environments":["prod"],"serviceName":"platform-service","project":"acme-prod","region":"us-central1"}
]'
```

Run target probe from chat before execution:

```text
probe targets jira DEV-123
probe targets pr owner/repo#42
```

Preflight checks:

- `EXECUTOR_PREFLIGHT_ENABLED=true` runs tool/auth checks before deployment.
- `EXECUTOR_PREFLIGHT_AUTH_CHECKS=true` enforces provider auth checks (`aws`, `az`, `gcloud`, `kubectl context`) for relevant targets.
- Set either to `false` when you intentionally want to bypass strict preflight validation.

Reference for Harness deployment target families:

- [Harness docs: Deploy services on different platforms](https://developer.harness.io/docs/category/deploy-services-on-different-platforms/)
- [AWS targets](https://developer.harness.io/docs/category/aws/)
- [Azure targets](https://developer.harness.io/docs/category/azure/)
- [GCP targets](https://developer.harness.io/docs/category/gcp/)
- [Kubernetes targets](https://developer.harness.io/docs/category/kubernetes/)
- [Helm targets](https://developer.harness.io/docs/category/helm/)
- [SSH and WinRM targets](https://developer.harness.io/docs/category/ssh-and-winrm/)
- [Serverless targets](https://developer.harness.io/docs/category/serverless/)

### Harness endpoint contract

- `HARNESS_PUBLISH_URL` request: `{ "action": "publish", "repo": "...", "buildOutput": "..." }`
- `HARNESS_DEPLOY_URL` request: `{ "action": "deploy", "environment": "dev|prod", "artifact": "..." }`
- `HARNESS_SCAN_URL` request: `{ "action": "scan", "artifact": "..." }`
- Accepted response run ID keys: `pipelineExecutionId`, `executionId`, `runId`, or `id`
- Scan response: `{ "critical": 0, "high": 0, "medium": 0, "low": 0 }` (or under `findings`)

### Chat commands

- `run jira DEV-123`
- `run pr owner/repo#42`
- `probe targets jira DEV-123`
- `probe targets pr owner/repo#42`
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
