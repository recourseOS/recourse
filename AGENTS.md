# Repository Guidelines

## Project Structure & Module Organization

RecourseOS is primarily a TypeScript CLI and MCP server. Core source lives in `src/`, organized by capability: `analyzer/`, `evaluator/`, `resources/`, `state/`, `mcp/`, `attestation/`, `verification/`, and `output/`. CLI entrypoints are `src/index.ts` and `src/cli.ts`; the packaged executable is `bin/recourse`. Tests live in `tests/`, with fixtures in `tests/fixtures/` and helpers in `tests/helpers/`. Documentation and static site assets are in `docs/`; schemas are in `schemas/`; Terraform examples are in `terraform/`. The Go SDK is under `recourse-go/`, standalone packages under `packages/`, and external adapters under `integrations/`.

## Build, Test, and Development Commands

- `npm run build`: compile TypeScript from `src/` into `dist/`.
- `npm run dev`: run `tsc --watch` during local development.
- `npm test`: run the Vitest suite, excluding visual specs.
- `npm run test:all`: build, run Vitest, then run CLI scenario tests.
- `npm run test:docs:visual`: run Playwright visual checks against `docs/`.
- `npm run lint`: run ESLint over `src/**/*.ts`.
- `npm run docs:all`: regenerate resource coverage and doc pages.
- `npm run mcp:smoke`: build and smoke-test the MCP server.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, and explicit `.js` extensions in relative imports. Follow the existing 2-space indentation, single quotes, semicolons, and descriptive kebab-case filenames such as `blast-radius.ts` or `cross-action.test.ts`. Keep domain logic in the relevant capability folder rather than adding broad utility modules. Generated `dist/`, local caches, and screenshots should not be hand-edited.

## Testing Guidelines

Use Vitest for unit and integration tests. Name tests `*.test.ts`; reserve `*visual.spec.ts` for Playwright because Vitest excludes those by config. Put reusable plans, states, and evidence under `tests/fixtures/`. Add focused regression tests when changing recoverability rules, parsers, attestation formats, or CLI behavior. Live AWS tests require `RUN_AWS_LIVE_TESTS=1` and should not run by default.

## Commit & Pull Request Guidelines

Recent commits use concise imperative summaries, often title case, for example `Fix test suite and update visual test coverage`. Keep commits scoped to one concern. Pull requests should describe the behavior change, list validation commands run, link related issues, and include screenshots when changing `docs/` pages or visual output. Note any schema, fixture, or generated-doc updates explicitly.

## Security & Configuration Tips

Do not commit credentials, live cloud outputs, or private Terraform state. Treat attestation keys, AWS evidence, and MCP server configuration as sensitive unless they are documented test fixtures.
