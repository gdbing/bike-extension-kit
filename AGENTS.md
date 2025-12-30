# Repository Guidelines

## Project Structure & Module Organization
- Extensions live in `src/` as `*.bkext` folders. Each extension can include `app/`, `dom/`, `style/`, `theme/`, and a `manifest.json`.
- Build output is written to `out/extensions/`.
- API type definitions are in `api/` (`api/app`, `api/dom`, `api/style`).
- Tests live under `tests/` (LLM chat tests in `tests/llm-chat`).
- Build and tooling scripts are in `scripts/` and TypeScript configs in `configs/`.

## Build, Test, and Development Commands
- `npm run new`: scaffold a new extension in `src/`.
- `npm run watch`: build all extensions and rebuild on changes (dev loop).
- `npm run build`: production build of all extensions.
- `npm run build-internals`: build internal API components.
- `npm run test:llm-chat`: compile and run the LLM chat test suite.

## Coding Style & Naming Conventions
- TypeScript with strict settings (see `tsconfig.json` and `configs/`).
- Indentation is two spaces; follow existing file patterns.
- Entry points: `src/**/app/main.ts`, `src/**/style/main.ts`, `src/**/dom/*.ts|tsx`.
- Prefer small, focused modules; keep extension-specific helpers in the extension folder.

## Testing Guidelines
- Current tests are TypeScript + Node-based (see `tests/llm-chat`).
- Run with `npm run test:llm-chat`.
- No global coverage requirement is defined; add tests when behavior changes.

## Commit & Pull Request Guidelines
- Commit messages use short, sentence-case summaries (e.g., “Add OpenAI provider…”).
- Keep commits scoped to a single change or feature.
- PRs should describe the change, include commands run, and mention any new configuration keys or UI additions.

## Configuration & Security Notes
- Runtime configuration is in `src/<extension>.bkext/config.json`.
- Network access is governed by `manifest.json` `host_permissions`; keep scopes minimal.
