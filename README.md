# AI-First DevOps Monorepo

This repo is a starter scaffold for an AI-driven DevOps platform supporting Web (TS/JS/Node), Backend (Python/Go/Java), Functions, Salesforce, and Mobile, deployable to Kubernetes or VMs across clouds.

## Quick Start
- Bootstrap: `make setup`
- Build all apps: `make build`
- Test: `make test`
- Local container images: `make docker-build`
- Plan/apply infra (Terraform example env): `make infra-plan` / `make infra-apply`
- Deploy to Kubernetes with Helm: `make deploy-k8s`

Helper CLI: `scripts/devopsctl.sh [build|test|plan|apply|deploy]`.

## Structure
- `apps/`: services and examples (`web`, `api-python`, `api-go`, `api-java`, `functions`, `mobile`, `salesforce`).
- `apps/console`: AI-first web console (Next.js) — chat, plans, runs.
- `ops/`: platform config
  - `terraform/`: cloud infra (example AWS env)
  - `helm/`: generic app chart
  - `argocd/`: GitOps application manifest
- `.github/workflows/`: CI for build/test.

## AI-First Flow
- Agents open PRs to modify code, tests, IaC, and Helm.
- GitOps deploys via Argo CD; policies and approvals enforce safety.

## Run the Web Console
- Install deps: `cd apps/console && npm install`
- Dev server: `npm run dev` (http://localhost:4000)
- Mocked backend: uses in-memory store to simulate planning and run streaming.

### Auth (NextAuth + GitHub)
- Set env vars in `apps/console/.env.local`:
  - `NEXTAUTH_SECRET=your_random_string`
  - `GITHUB_ID=...` and `GITHUB_SECRET=...`
  - Optional admins: `ADMIN_EMAILS=alice@example.com,bob@example.com`
- Start and sign in via the header button. Admins can approve requests; developers can request approvals.

Quick testing without auth
- To bypass auth entirely, set `AUTH_DISABLED=true` in `apps/console/.env.local`. The console will hide sign-in and API routes will not require authentication.

## Approvals, Policy, Environments
- After planning, policies are evaluated; prod deploys require canary/blue-green.
- Request and approve changes in-UI before execution.
- Define environments at `/environments` (cloud, target, region) for future deploy targeting.
- Use the Deployments Wizard at `/deployments` to choose a service and environment, preview Helm values, create a plan, and execute.
  - The wizard auto-suggests the latest image tag (best-effort) for GHCR images and fills Helm values (image repo/tag, service targetPort) based on the selected service.
  - Policy checks run after plan creation; Execute is disabled if policy fails (Conftest supported when installed).

### Caching & Security Hardening
- API responses are sent with `Cache-Control: no-store`.
- Static assets under `/_next/static/*` are cached for 1 year with `immutable`.
- HTML/pages use a short cache (`max-age=60`) suitable for local and simple deployments; customize per route as needed.
- Image optimization is disabled (`images.unoptimized: true`) to avoid legacy DoS vectors when not using next/image.

### CI Security
- NPM Audit workflow checks `apps/console` dependencies on PR and `main` (fails on high severity): `.github/workflows/npm-audit.yml`.

See `AGENTS.md` for contribution standards.
