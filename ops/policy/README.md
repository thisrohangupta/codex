# Policy Placeholders

Use this directory for OPA/Rego or Conftest policies. Example rules:
- Require canary or blue/green for production.
- Block deployments without verification gates.
- Enforce image signing and SBOM presence.

Wire these into the console by replacing the simple code-based evaluator in `apps/console/server/policy.ts`.

