# Repository Guidelines

## Project Structure & Module Organization

This repository is a native browser ES-module extension for SillyTavern. `index.js` is the extension entry point, while focused modules live in `src/` (for example, `actions.js`, `request.js`, `settings.js`, and `ui.js`). Keep business logic in these modules rather than expanding the entry point. Tests are in `tests/` and generally mirror module names, such as `src/runtime.js` and `tests/runtime.test.js`. Root-level integration assets include `manifest.json`, `settings.html`, and `style.css`.

## Build, Test, and Development Commands

- `npm install` installs the Vitest and jsdom development dependencies.
- `npm test` runs the complete test suite once with Vitest.
- `npm run test:watch` reruns relevant tests while files change.

There is no compilation step or runtime dependency bundle. For manual testing, place or symlink the repository at `SillyTavern/public/scripts/extensions/third-party/guided-turns`, then reload SillyTavern. Validate changes against SillyTavern 1.18.0 or newer.

## Coding Style & Naming Conventions

Use modern JavaScript ES modules, four-space indentation, semicolons, and single quotes. Preserve the SPDX license header in JavaScript files. Prefer `camelCase` for variables and functions, `PascalCase` for classes, and uppercase snake case for exported constants. Keep modules narrowly scoped and use dependency injection for SillyTavern globals where practical so logic remains testable. No formatter or linter is configured; match surrounding code and keep diffs focused.

## Testing Guidelines

Tests use Vitest with the jsdom environment. Name files `tests/<module>.test.js` and group behavior with `describe`/`it`. Mock browser and SillyTavern APIs with `vi.fn()` or `vi.spyOn()`, and clean up observers or DOM state after tests. Add regression coverage for behavior changes, especially request cancellation, streaming state, profile validation, prompt handling, and swipe metadata. Run `npm test` before submitting changes. Coverage reporting is available through Vitest configuration, but no numeric threshold is enforced.

## Commit & Pull Request Guidelines

Use detailed Conventional Commits-style messages, such as `fix(ui): restore outline button visibility` or `feat(swipes): add streaming swipe metadata`. Keep the subject concise and imperative, then include a body when useful to explain the behavior, rationale, compatibility impact, and tests. Prefer multiple focused commits for separate logical changes instead of combining unrelated work into one large commit. Pull requests should explain user-visible behavior, summarize tests performed, and link relevant issues. Include screenshots or a short recording for changes to `settings.html`, `style.css`, or action-bar behavior. Call out compatibility, manifest, or configuration changes explicitly.

## Agent-Specific Instructions

Do not create or switch to a new Git branch unless the user explicitly asks for one. When asked to commit or push, use the current branch unless instructed otherwise.
When asked to push changes that include code, bump the project version before pushing and include the version change in the commit.
