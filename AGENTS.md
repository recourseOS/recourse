# Repository Guidelines

## Project Structure & Module Organization

This is a Node.js TypeScript CLI for analyzing Terraform plans. Source code lives in `src/`: `cli.ts` and `index.ts` define Commander entry points, `parsers/` reads Terraform JSON, `analyzer/` coordinates blast-radius analysis, `resources/` contains AWS handlers, `classifier/` holds feature logic, and `output/` formats reports. Tests are in `tests/`, with fixtures in `tests/fixtures/`. Terraform examples and plans live under `terraform/`. Static site assets are in `docs/`. Build output is generated in `dist/` and should not be edited by hand.

## Build, Test, and Development Commands

- `npm install`: install dependencies; Node.js `>=18` is required.
- `npm run build`: compile TypeScript into `dist/`.
- `npm run dev`: run `tsc --watch`.
- `npm test`: run the Vitest suite.
- `npm run test:docs:visual`: run Playwright desktop/mobile checks against the docs site; screenshots are generated under ignored `docs-visual-screenshots/`. Run `npx playwright install chromium` once if browser binaries are missing.
- `npm run lint`: run ESLint over `src/**/*.ts`.
- `node dist/index.js plan <plan.json>`: run the CLI after building.
- `node dist/index.js evaluate <source> <input> --submit`: submit a consequence report to Recourse Cloud when `RECOURSE_CLOUD_URL`, `RECOURSE_ORGANIZATION_ID`, and an actor are configured.
- `node dist/index.js resources`: list resource types.
- `npm run preview` / `npm run deploy`: run or deploy the Wrangler configuration.

## Coding Style & Naming Conventions

Use strict TypeScript with ES modules and explicit `.js` extensions in relative imports. Prefer two-space indentation, single quotes, semicolons, and `camelCase`. Resource handlers are grouped by provider and service, for example `src/resources/aws/s3.ts`, `src/resources/gcp/storage.ts`, and `src/resources/azure/storage.ts`; new handlers should implement `src/resources/types.ts` contracts and be registered in `src/resources/index.ts`. Keep handlers authoritative. Unknown resources flow through `src/classifier/semantic-unknown.ts` before the legacy decision tree; keep that path conservative and BitNet-compatible.

## Testing Guidelines

Tests use Vitest and live in `tests/*.test.ts`. Name suites after the unit or behavior under test, such as `describe('analyzeBlastRadius', ...)`, and write fixtures that mirror Terraform JSON. Add tests for new handlers, parser behavior, or recoverability edge cases; use `tests/multicloud-rules.test.ts` for provider-specific GCP/Azure rules, `tests/semantic-unknown-classifier.test.ts` for provider-neutral unknown-resource behavior, `tests/golden-plan-fixtures.test.ts` for end-to-end provider fixture contracts, `tests/resource-coverage-doc.test.ts` for coverage-doc drift, and `tests/doc-pages.test.ts` for themed docs drift. Playwright visual specs use the `*visual.spec.ts` suffix and are excluded from Vitest by `vitest.config.ts`; use `tests/docs-visual.spec.ts` for docs visual smoke coverage. Run `npm test` before opening a pull request; run `npm run build` when touching public types or CLI wiring.

## Commit & Pull Request Guidelines

Recent commits use short, imperative messages such as `Make favicon larger by tightening viewBox`. Keep commits focused and describe the user-visible or behavioral change. Pull requests should include a summary, tests run, linked issues when applicable, and screenshots for `docs/` changes. For recoverability rules, include an example Terraform plan or fixture.

## Agent-Specific Instructions

Do not overwrite generated `dist/` files unless the task requires a build artifact. Preserve Terraform fixtures and add new ones instead of weakening coverage. When changing classification logic, update both the rule implementation and tests. After adding or removing resource handlers or changing Markdown-backed public docs, run `npm run docs:all` and commit the resulting `docs/*.md` and `docs/*.html` updates. Unknown-resource classifiers must stay conservative: rules win for known resources, semantic profiles feed the unknown-resource scorer, and low-evidence destructive changes should not be marked safe. Cloud submission code must keep local evaluation authoritative: stdout remains report JSON, submission status goes to stderr, and submission failures must not hide or alter the local decision.
