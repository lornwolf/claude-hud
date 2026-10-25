# CLAUDE.md

Claude HUD is a Claude Code plugin: a [status line](https://code.claude.com/docs/en/statusline) command that prints a two-line HUD (model, project, git, context, usage), plus opt-in lines for tools, agents, todos, and more.

This repository holds two things: the plugin itself at the root (`src/`, `dist/`, `commands/`, `scripts/`, `tests/`) and my own status line scripts in `custom/`, which run the plugin in-process and add a date line and a CPU/RAM line. See "This repository" below before changing either side.

## Commands

```bash
npm ci
npm test                           # builds dist/, then runs node --test
npm run test:update-snapshots      # regenerate tests/golden/expected.txt after an intended output change
echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":45,"context_window_size":200000}}' | node dist/index.js

# custom/ entry, run against this checkout's dist/ (prints the HUD plus the date and CPU/RAM lines; no "[claude-hud] Error:" expected)
echo '{"cwd":"'"$PWD"'","model":{"display_name":"x"}}' | CLAUDE_HUD_PLUGIN_DIR=$PWD COLUMNS=100 node custom/hud-render.mjs
SYSLINE_DATE=2026-09-25 SYSLINE_LANG=ja node custom/sys-usage-line.mjs   # date line only
```

## How a render works

Claude Code runs the command after each message, `/compact`, a mode change, a rate-limit reset, or a prompt-cache expiry (debounced 300ms), plus on `refreshInterval` if set. Each run is a fresh process:

1. `stdin.ts` reads the payload. It targets Claude Code ≥ 2.1.260 and trusts its fields (`version`, `cost`, `prompt_cache`, `session_name`, `output_style`, `workspace.repo`, `rate_limits`) instead of deriving them.
2. `config.ts` loads `plugins/claude-hud/config.json` plus the per-directory `claude-hud.json` override. `DEFAULT_CONFIG` is the schema; a rules table validates each key.
3. `index.ts` gathers only what enabled elements need, in parallel: the transcript (`transcript.ts`), git or jj (`git.ts`, `jj.ts`), the extra command, memory, auth, config counts, the usage snapshot, the cost ledger, and speed state. All I/O and state writes happen here.
4. `render/` turns that into lines without I/O. Each element has one implementation in `parts.ts`, `context.ts`, `usage.ts`, `vcs.ts`, `lines.ts`, and `activity.ts`. `expanded.ts` and `compact.ts` only arrange those parts, and `ansi.ts` measures and wraps.

## Invariants

- The default HUD is two lines. New display is opt-in (CONTRIBUTING.md has the scope rules; this repository takes no outside pull requests, but the rules still describe what belongs in the plugin and what belongs in `custom/`).
- Text from stdin, the transcript, git, or config is untrusted terminal input. Sanitize it (`utils/sanitize.ts`) before it's printed.
- Rendering is pure: the clock and terminal width are sampled once in `renderLines`.
- `tests/golden.test.js` pins end-to-end output. An output change must show up as a reviewed diff to `tests/golden/expected.txt`.
- `dist/` is committed here: `custom/hud-render.mjs` imports it, and there is no CI in this repository. After a change under `src/`, run `npm test` (which rebuilds `dist/`) and commit `dist/` together with the source. The build is reproducible; a rebuild of unchanged sources must leave `git status` clean.
- `README.md` and `README.zh.md` document every key in `DEFAULT_CONFIG`, and `tests/readme-options.test.js` enforces it. The test counts every table row whose first cell is a bare backticked word (`| \`name\` |`), so tables in the custom section at the end of both READMEs must not use that shape for non-config names (write `custom/config.json`, not `config.json`).

## Setup

`/claude-hud:setup` (`commands/setup.md`) runs `scripts/setup.mjs`. That copies `scripts/statusline.mjs` to `<config dir>/plugins/claude-hud/` and points `statusLine.command` at it. The launcher runs the newest installed version, so plugin updates never need setup again. Plugins can't set `statusLine` themselves, so this step writes the user's `settings.json`.

**Do not run `/claude-hud:setup` on my machines.** Their `statusLine.command` is a single node call to `~/.claude/plugins/claude-hud/hud-render.mjs` (from `custom/`); setup would overwrite it with the stock launcher and the date and CPU/RAM lines would disappear.

Runtime: Node.js 18+ or Bun for the plugin; `custom/` needs Node.js 20+ (`hud-collector.mjs` uses recursive `fs.watch`, which Linux only has from 20). Build: TypeScript, ES2022, NodeNext modules.

## This repository

- `custom/` is documented in the last section of `README.md` / `README.zh.md` ("我对 claude-hud 的定制"). Keep that section when editing either README; the two copies are identical and should stay so.
- `custom/hud-pipeline.mjs` is the only file that depends on the plugin's internals: it imports the `dist/` modules and mirrors `src/index.ts` `main()` step by step, exposing injection points for `readStdin`, `loadConfig`, `getGitStatus`, `getUsageFromStdin`, `parseTranscript` and `log`. Any change to the flow in `src/index.ts`, to `RenderContext`, or to the exports it imports must be mirrored there, then verified with the `custom/hud-render.mjs` command above.
- Keep `src/` as it is unless the change is meant for the plugin itself; behaviour I want only for myself goes in `custom/`.
- Deploying `custom/` is a copy, not a build, and `custom/install.mjs` does all of it (`node custom/install.mjs`; also exposed as `/claude-hud:install-custom` via `commands/install-custom.md`): installs or updates the plugin through the `claude` CLI, copies the `.mjs` files to `~/.claude/plugins/claude-hud/`, writes a missing `config.json`, rewrites `statusLine` in `settings.json` with a backup, kills the old `hud-collector.mjs` and runs one render to verify. It must stay idempotent: a second run on an installed machine changes nothing. Runtime files the scripts write next to themselves (`shared/`, `*.stamp`, `*.lock`, logs, snapshots) are gitignored.
