# Contributing

Thanks for contributing! This project is an AI-first DevOps platform. Please read AGENTS.md for contributor standards and workflows.

## Get Started
- Prereqs: Node 20+, Docker, Helm (optional), Terraform (optional).
- Install console deps: `cd apps/console && npm install`
- Dev server: `npm run dev` → http://localhost:4000
- Make targets: `make build`, `make test`, `make docker-build`, `make deploy-k8s`

## Dev Workflow
- Prefer small PRs with clear scope. Follow Conventional Commits, e.g., `feat(console): add deployments wizard`.
- Run format/lint: `make fmt && make lint` (or stack equivalents).
- Add/Update tests near changes (see `apps/*/tests` patterns).
- No secrets in code. Use `.env.local` with placeholders mirrored in `.env.example`.

## Pull Requests
- Use the PR template. Include rationale, steps to test, and screenshots for UI.
- Link issues (Closes #123) and include rollout plan (staging → prod, canary/rollback).
- CI must pass. For auto-merge, add the `automerge` label (requires repo auto-merge enabled).

## Ownership & Reviews
- CODEOWNERS auto-assigns reviewers by path. Ping owners if time-sensitive.

## Security
- See SECURITY.md. Report vulnerabilities privately; do not file public issues.

## Policy & Approvals
- Production deploy plans require canary/blue-green and verification gates. Use the in-UI approval flow; admins approve.

