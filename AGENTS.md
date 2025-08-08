# Repository Guidelines

This repository is currently a skeleton. Use these guidelines to keep structure, tooling, and contributions consistent as code is added.

## Project Structure & Module Organization
- Root: project metadata (README, LICENSE, `.gitignore`, this file).
- `src/`: application/library source code organized by feature.
- `tests/`: mirrors `src/` with unit/integration tests.
- `scripts/`: developer utilities (setup, release, CI helpers).
- `docs/`: architecture notes and ADRs; keep concise.
- `.github/workflows/`: CI pipelines (lint, test, build).
- `examples/` and `assets/` as needed for demos and static files.

Example layout:
```
src/
tests/
scripts/
docs/
.github/workflows/
```

## Build, Test, and Development Commands
- Preferred entrypoints: `make` targets. If `Makefile` exists:
  - `make setup`: install toolchains/deps.
  - `make build`: compile/bundle the project.
  - `make test`: run all tests with coverage.
  - `make lint` / `make fmt`: static checks and formatting.
- If no Makefile, use stack-native commands, e.g. `npm test`, `pytest -q`, or `cargo test` depending on language.

## Coding Style & Naming Conventions
- Formatting: enforce with tooling (examples: Prettier/ESLint for JS/TS, Black/ruff for Python, `rustfmt`/`clippy` for Rust).
- Indentation: spaces only; 2 for JS/TS, 4 for Python; follow language norms.
- Naming: `PascalCase` for types/classes, `camelCase` for variables/functions (JS/TS), `snake_case` for Python modules/files; kebab-case for CLI/package names.
- Run `make fmt && make lint` (or stack equivalents) before committing.

## Testing Guidelines
- Place tests in `tests/` mirroring `src/` paths.
- File names: `*_test.py`, `*.spec.ts`, or `<name>_test.rs` per language.
- Target ≥80% coverage for changed code; add regression tests for bug fixes.
- Run locally via `make test` (or `npm test` / `pytest` / `cargo test`).

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits, e.g. `feat(api): add token refresh`.
- Scope small, message imperative; reference issues (`Closes #123`).
- PRs: clear description, rationale, screenshots for UI, steps to reproduce/verify, and checklist: tests passing, lint clean, no secrets.

## Security & Configuration Tips
- Never commit secrets; use environment variables and `.env.example` for placeholders.
- Document required env vars in README; prefer least-privilege API keys.
