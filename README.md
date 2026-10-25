# Claude HUD

A Claude Code plugin that shows what's happening — context usage, active tools, running agents, and todo progress. Always visible below your input.

> 🌐 English | [中文文档](README.zh.md)

> 📌 本仓库是上游 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud) **0.8.0** 的原样快照（MIT）加上 `custom/` 里我自己的 statusLine 定制脚本。为什么钉在 0.8.0、定制怎么装，见文末「[我对 claude-hud 的定制](#我对-claude-hud-的定制custom)」。

## Install

Inside a Claude Code instance, run the following commands:

**Step 1: Add the marketplace**
```
/plugin marketplace add jarrodwatts/claude-hud
```

**Step 2: Install the plugin**

<details>
<summary><strong>⚠️ Linux users: Click here if install fails with an EXDEV error</strong></summary>

On older Claude Code versions, `/tmp` being a separate filesystem (tmpfs) caused plugin installation to fail with:
```
EXDEV: cross-device link not permitted
```

This [Claude Code bug](https://github.com/anthropics/claude-code/issues/14799) has since been fixed — if you hit it, update Claude Code first. If you can't update, set TMPDIR before installing:
```bash
mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp claude
```

Then run the install command below in that session.

</details>

```
/plugin install claude-hud
```

After that, reload plugins (no restart needed):

```
/reload-plugins
```

<details>
<summary><strong>Prefer the terminal?</strong></summary>

Steps 1–2 can also be done outside a session with the Claude Code CLI:
```bash
claude plugin marketplace add jarrodwatts/claude-hud
claude plugin install claude-hud@claude-hud
```
Then run `/reload-plugins` inside your session (or start a new one).

</details>

**Step 3: Configure the statusline**
```
/claude-hud:setup
```

<details>
<summary><strong>⚠️ Windows users: Click here if setup says no JavaScript runtime was found</strong></summary>

On Windows, Node.js LTS is the supported runtime for Claude HUD setup. If setup says no JavaScript runtime was found, install Node.js for your shell first:
```powershell
winget install OpenJS.NodeJS.LTS
```
Then restart your shell and run `/claude-hud:setup` again.

</details>

Done! Claude Code reloads settings automatically — the HUD appears after your next message, no restart needed. If it doesn't show up, restart Claude Code (older versions require a restart to pick up statusLine changes).

---

## What is Claude HUD?

Claude HUD gives you better insights into what's happening in your Claude Code session.

| What You See | Why It Matters |
|--------------|----------------|
| **Project path** | Know which project you're in (configurable 1-3 directory levels) |
| **Context health** | Know exactly how full your context window is before it's too late |
| **Tool activity** | Watch Claude read, edit, and search files as it happens |
| **Agent tracking** | See which subagents are running and what they're doing |
| **Todo progress** | Track task completion in real-time |

## What You See

### Default (2 lines)
```
[Opus] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
```
- **Line 1** — Model, provider label when positively identified (for example `Bedrock`, `Vertex`, `MiniMax`), project path, git branch
- **Line 2** — Context bar (green → yellow → red) and usage rate limits

### Optional lines (enable via `/claude-hud:configure`)
```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← Tools activity
◐ explore [haiku]: Finding auth code (2m 15s)    ← Agent status
▸ Fix authentication bug (2/5)                   ← Todo progress
```

---

## How It Works

Claude HUD uses Claude Code's native **statusline API** — no separate window, no tmux required, works in any terminal.

```
Claude Code → stdin JSON → claude-hud → stdout → displayed in your terminal
           ↘ transcript JSONL (tools, agents, todos)
```

**Key features:**
- Native token data from Claude Code (not estimated)
- Scales with Claude Code's reported context window size, including newer 1M-context sessions
- Parses the transcript for tool/agent activity
- Re-renders after each interaction (new assistant messages, `/compact`, permission changes, vim-mode toggles), debounced at 300ms

---

## Configuration

Customize your HUD anytime:

```
/claude-hud:configure
```

The guided flow handles layout, language, and common display toggles. Advanced overrides such as
custom colors and thresholds are preserved there, but you set them by editing the config file directly:

- **First time setup**: Choose a preset (Full/Essential/Minimal), pick a label language, then fine-tune individual elements
- **Customize anytime**: Toggle items on/off, adjust git display style, switch layouts, or change label language
- **Preview before saving**: See exactly how your HUD will look before committing changes

### Presets

| Preset | What's Shown |
|--------|--------------|
| **Full** | Everything enabled — tools, agents, todos, git, usage, duration |
| **Essential** | Activity lines + git status, minimal info clutter |
| **Minimal** | Core only — just model name and context bar |

After choosing a preset, you can turn individual elements on or off.

### Manual Configuration

Edit `~/.claude/plugins/claude-hud/config.json` directly for advanced settings such as `colors.*`,
`pathLevels`, `maxWidth`, threshold overrides, `display.timeFormat`, `display.hourCycle`, and `display.promptCacheTtlSeconds`. Running `/claude-hud:configure`
preserves those manual settings while still letting you change `language`, layout, and the common
guided toggles.

If you run several Claude config directories via `CLAUDE_CONFIG_DIR` and symlink `plugins/` to a
shared location, `plugins/claude-hud/config.json` is the same physical file for all of them. Put
per-directory settings in `$CLAUDE_CONFIG_DIR/claude-hud.json` instead - it uses the same shape,
only needs the keys it changes, and is layered on top of the shared config at load time:

For example, put this in `~/.config/claude/work/claude-hud.json`:

```json
{ "display": { "customLine": "Work Team" } }
```

Simplified and Traditional Chinese HUD labels are available as explicit opt-ins. English stays the default unless you choose a Chinese locale in `/claude-hud:configure` or set `language` in config. The `zh` alias maps to Simplified Chinese, and `zh-TW` maps to Traditional Chinese. Guided config writes the canonical `zh-Hans` or `zh-Hant` value.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `language` | `en` \| `zh` \| `zh-Hans` \| `zh-Hant` \| `zh-TW` | `en` | HUD label language. Use `zh` or `zh-Hans` for Simplified Chinese and `zh-Hant` or `zh-TW` for Traditional Chinese. |
| `lineLayout` | string | `expanded` | Layout: `expanded` (multi-line) or `compact` (single line) |
| `pathLevels` | 1-3 \| `full` | 1 | Directory levels to show in project path, or `full` to show the entire absolute path |
| `maxWidth` | number \| `null` | `null` | Optional fallback width used only when terminal width detection fails completely |
| `forceMaxWidth` | boolean | false | Always use `maxWidth` when it is set, even if terminal width detection returns a smaller value |
| `elementOrder` | string[] | `["project","addedDirs","context","usage","promptCache","memory","environment","tools","skills","mcp","agents","todos","sessionTime"]` | Expanded-mode element order. Omit entries to hide them in expanded mode. Existing configs keep their explicit order until updated. |
| `projectLineOrder` | string[] | `[]` | Optional leading order of segments *within* the first line, in both layouts. Visibility stays with the `display.show*` flags, and omitted segments retain their existing renderer order. `model` covers provider + model + effort (plus the context bar in compact mode); `project` covers path + added dirs + git as one segment. Example: `["project","model"]` puts the project/git block before the model badge. |
| `display.mergeGroups` | string[][] | `[["context","usage"]]` | Expanded-mode groups that should share a line when adjacent. Set `[]` to disable merged lines. |
| `display.rightAlign` | string[] | `[]` | Starts a right-aligned suffix at the first listed element in a merged row, preserving `elementOrder` and padding the gap with spaces. Requires the anchor to be in a `display.mergeGroups` group that actually renders on one line. Ignored when the terminal width is unknown, the anchor is first, or there is no room for padding. Example: `["context"]` with a `["project","context","usage"]` group keeps project/git left and pins context + usage right. |
| `gitStatus.enabled` | boolean | true | Show git branch in HUD |
| `gitStatus.showDirty` | boolean | true | Show `*` for uncommitted changes |
| `gitStatus.showAheadBehind` | boolean | false | Show `↑N ↓N` for ahead/behind remote |
| `gitStatus.pushWarningThreshold` | number | 0 | Color the ahead count with the warning color at or above this unpushed-commit count (`0` disables it) |
| `gitStatus.pushCriticalThreshold` | number | 0 | Color the ahead count with the critical color at or above this unpushed-commit count (`0` disables it) |
| `gitStatus.showFileStats` | boolean | false | Show file change counts `!M +A ✘D ?U` |
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | Keep current truncation behavior or let the git block wrap onto its own line boundary when possible |
| `jjStatus.enabled` | boolean | false | Opt in to jj (Jujutsu) status. When enabled and a real `.jj` directory is found, jj is used instead of git for that repo — never both |
| `jjStatus.showDirty` | boolean | true | Show `*` when the working-copy commit differs from its parent |
| `jjStatus.showConflicts` | boolean | true | Show a `!conflict` marker when the working-copy commit has an unresolved conflict |
| `display.showModel` | boolean | true | Show model name `[Opus]` |
| `display.modelSource` | `stdin` \| `auto` \| `transcript` | `stdin` | Controls which source the model name comes from. `stdin` preserves the default behavior and always uses what Claude Code reports. `auto` opts into proxy redirect detection by using transcript models only for non-Claude models. `transcript` always uses the model from the API response. Transcript model values are terminal-sanitized and capped at 80 characters |
| `display.showProvider` | boolean | false | Show the provider label *before* the model name, e.g. `[Bedrock \| Opus 4.6]`. Useful when a custom proxy serves identically-named models from different providers. When off, an auto-detected provider still trails the model as before |
| `display.providerName` | string | `""` | Explicit provider label used with `display.showProvider`, e.g. for a custom proxy that can't be auto-detected. Falls back to the auto-detected provider (Bedrock/Vertex/MiniMax/Enterprise) when empty; capped at 40 chars |
| `display.showAddedDirs` | boolean | true | Show extra workspace directories from `/add-dir` (e.g. `+sparkle +lib-foo`); empty array renders nothing. In both layouts at most 5 dirs render (overflow shown as `+N more`) and basenames are truncated to 24 chars with `…` |
| `display.addedDirsLayout` | `inline` \| `line` | `inline` | `inline` puts dirs next to the project name with a `+name` prefix per dir; `line` renders them on a separate `Added dirs: name1, name2` line (no `+` prefix, comma-separated) |
| `display.showContextBar` | boolean | true | Show visual context bar `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | Context display format (`45%`, `45k/200k`, `55%` remaining, or `45% (45k/200k)`) |
| `display.autoCompactWindow` | number \| `null` | `null` | When set to a positive number such as `200000`, compute the context percentage against this auto-compact window instead of the full model context window, matching the `/context` figure. Leave unset or `null` to preserve default full-window behavior. |
| `display.showConfigCounts` | boolean | false | Show CLAUDE.md, rules, MCPs, hooks counts |
| `display.showCost` | boolean | false | Show session cost using Claude Code's native `cost.total_cost_usd` when available, with a local estimate fallback for direct Anthropic sessions |
| `display.showRoutedCost` | boolean | false | Also show cost for routed providers (Bedrock/Vertex), which `showCost` hides by default. Requires `showCost` too. Uses the native `cost.total_cost_usd` when positive (`Cost`), otherwise the token estimate (`Est.`) |
| `display.showDailyCost` | boolean | false | Show today's cumulative spend across sessions as `Today $12.34`, accumulated from the native `cost.total_cost_usd` into a small per-day ledger in the plugin data directory. Resets at local midnight. Independent of `showCost` |
| `display.showOutputStyle` | boolean | false | Show the active Claude Code `outputStyle` from settings files as `style: <name>` |
| `display.showDuration` | boolean | false | Show session duration `⏱️ 5m` |
| `display.showSpeed` | boolean | false | Show output token speed `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | Show Claude subscriber usage limits when available |
| `display.usageValue` | `percent` \| `remaining` | `percent` | Usage display format (`25%` used, or `75%` remaining) |
| `display.usageBarEnabled` | boolean | true | Display usage as visual bar instead of text |
| `display.usageCompact` | boolean | false | Display usage in a shorter text form such as `5h: 25% (1h 30m)`; takes precedence over `display.usageBarEnabled` |
| `display.showResetLabel` | boolean | true | Show the `resets in` prefix before usage countdowns |
| `display.showModelScopedUsage` | boolean | true | Show the per-model weekly windows (`model_scoped`, e.g. Fable), whether they arrive on stdin or from the external usage snapshot. Set to `false` to render the usage line as if the payload carried none of them |
| `display.timeFormat` | `relative` \| `absolute` \| `both` \| `elapsed` \| `elapsedAndAbsolute` | `relative` | How usage-window time is shown: countdown only (`resets in 2h 30m`), wall-clock reset (`resets at 14:30`), both, elapsed window percentage (`53% elapsed`), or elapsed plus wall-clock reset |
| `display.hourCycle` | `auto` \| `h11` \| `h12` \| `h23` \| `h24` | `auto` | Hour cycle for wall-clock reset times (`absolute`/`both`/`elapsedAndAbsolute` modes). `auto` defers to the system locale; `h23` forces 24-hour time (`14:30`) regardless of locale |
| `display.showClockSeconds` | boolean | false | Show seconds in wall-clock reset times, e.g. `at 14:30:07` |
| `display.sevenDayThreshold` | 0-100 | 80 | Show 7-day usage when >= threshold (0 = always) |
| `display.externalUsagePath` | string | `""` | Optional absolute path to a local usage snapshot file. Relative paths are ignored. When stdin `rate_limits` are present, `balance_label` is appended and `model_scoped` windows fill in when stdin lacks them; when stdin windows are missing, valid usage windows can be used as a fallback |
| `display.externalUsageWritePath` | string | `""` | Optional absolute `.json` path in an existing directory. When stdin `rate_limits` exists, ClaudeHUD writes a private snapshot for other local tools. Relative paths, non-json files, and missing parent directories are ignored |
| `display.externalUsageFreshnessMs` | number | `300000` | Maximum allowed age for the external usage snapshot before it is ignored |
| `display.showTokenBreakdown` | boolean | true | Show token details at high context (85%+) |
| `display.showTools` | boolean | false | Show tools activity line |
| `display.showSkills` | boolean | false | Show active Skills detected from `Skill` tool invocations |
| `display.showMcp` | boolean | false | Show active MCP servers detected from `mcp__server__tool` invocations |
| `display.toolNameMaxLength` | number | `0` | Maximum displayed tool-name length. `0` keeps full names; MCP names may shorten to their final segment when truncating |
| `display.toolsMaxVisible` | number | `4` | Maximum completed tools shown on the tools line. `0` means unlimited |
| `display.showAgents` | boolean | false | Show agents activity line |
| `display.showTodos` | boolean | false | Show todos progress line |
| `display.showSessionName` | boolean | false | Show session slug or custom title from `/rename` |
| `display.showAuth` | boolean | false | Show the auth method (subscription plan) of the current login as its own segment at the end of the first line, e.g. `Claude Max 20x`. Derived from the `oauthAccount` block in `{CLAUDE_CONFIG_DIR}.json`; shows `API Key` when there is no OAuth login but `ANTHROPIC_API_KEY` is set |
| `display.showAuthUser` | boolean | false | Show the logged-in account (email local part, falling back to profile display name) next to the auth method |
| `display.authUserLength` | number | `8` | Maximum characters of the account name to display before truncating with `…`. `0` shows the full name |
| `display.showAdvisor` | boolean | false | Inline the model configured via Claude Code's `/advisor` on the project line, e.g. `Advisor: Opus 4.7`. Read from the `advisorModel` field that Claude Code stamps on each assistant transcript record; sanitised and capped at 64 chars before rendering |
| `display.advisorOverride` | string | `""` | Optional manual override for the displayed advisor label. When non-empty, replaces transcript-driven detection. Also sanitised and capped at 64 chars |
| `display.showSessionStartDate` | boolean | false | Show the transcript session start timestamp |
| `display.showLastResponseAt` | boolean | false | Show how long ago the last assistant response was written |
| `display.showCompactions` | boolean | false | Show how many context compactions (manual `/compact` or auto) have occurred this session, counted from transcript `compact_boundary` entries, e.g. `Compactions: 2`. Hidden until the first compaction |
| `display.showEffortLevel` | boolean | false | Show the current reasoning effort in the model badge. Ultracode renders as `ultracode(xhigh)`, detected from the session transcript so it tracks `/effort` changes made at runtime |
| `display.effortFormat` | `full` \| `symbol` \| `text` | `full` | How the effort renders when `display.showEffortLevel` is on: symbol and level text (`◑ high`), symbol only (`◑`), or level text only (`high`). Ultracode keeps the full `◕ ultracode(xhigh)` form under `symbol` so the marker is not lost, and levels without a known symbol fall back to the level text |
| `display.showClaudeCodeVersion` | boolean | false | Show the installed Claude Code version, e.g. `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | Show an approximate system RAM usage line in expanded layout |
| `display.showPromptCache` | boolean | false | Show the wall-clock time the session's prompt cache expires, read from the transcript |
| `display.promptCacheTtlSeconds` | number | `300` | Compatibility fallback used only when the transcript has not reported a 5-minute or 1-hour cache tier |
| `colors.context` | color value | `green` | Base color for the context bar and context percentage |
| `colors.usage` | color value | `brightBlue` | Base color for usage bars and percentages below warning thresholds |
| `colors.warning` | color value | `yellow` | Warning color for context thresholds and usage warning text |
| `colors.usageWarning` | color value | `brightMagenta` | Warning color for usage bars and percentages near their threshold |
| `colors.critical` | color value | `red` | Critical color for limit-reached states and critical thresholds |
| `colors.model` | color value | `cyan` | Color for the model badge such as `[Opus]` |
| `colors.project` | color value | `yellow` | Color for the project path |
| `colors.git` | color value | `magenta` | Color for git wrapper text such as `git:(` and `)` |
| `colors.gitBranch` | color value | `cyan` | Color for the git branch and branch status text |
| `colors.label` | color value | `dim` | Color for labels and secondary metadata such as `Context`, `Usage`, counts, and progress text |
| `colors.custom` | color value | `208` | Color for the optional custom line |
| `colors.barFilled` | string | `█` | Character used for the filled portion of progress bars |
| `colors.barEmpty` | string | `░` | Character used for the empty portion of progress bars |

`colors.barFilled` and `colors.barEmpty` accept a single visible grapheme. Control characters, invisible format characters (bidi controls, zero-width joiners, variation selectors), line/paragraph separators, and noncharacters are rejected. Wide characters (emoji, CJK) may affect bar alignment depending on the terminal.

Supported color names: `dim`, `red`, `green`, `yellow`, `magenta`, `cyan`, `brightBlue`, `brightMagenta`. You can also use a 256-color number (`0-255`) or hex (`#rrggbb`).

`display.showMemoryUsage` is fully opt-in and only renders in `expanded` layout. It reports approximate system RAM usage from the local machine, not precise memory pressure inside Claude Code or a specific process. The number may overstate actual pressure because reclaimable OS cache and buffers can still be counted as used memory.

`display.showCost` is fully opt-in. ClaudeHUD prefers the native `cost.total_cost_usd` field that Claude Code provides on stdin when it is available. If that field is absent or invalid for a direct Anthropic session, ClaudeHUD falls back to the existing local transcript-based estimate so the cost line still works on older payloads. The native field is absent before the first API response in a session, so the cost display may stay hidden until then. ClaudeHUD also keeps the cost hidden for known routed providers such as Bedrock and Vertex AI, because cloud-provider billed sessions may report `$0.00` or omit the field even though the session was not literally free. Set `display.showRoutedCost: true` (alongside `showCost`) to opt into cost for those providers anyway: the native `cost.total_cost_usd` is shown as `Cost` when positive, otherwise ClaudeHUD falls back to a token-based `Est.` from the Anthropic pricing table.

`display.showDailyCost` is fully opt-in and answers a different question than `showCost`: what has the whole day cost across sessions, not just the current conversation. On each render ClaudeHUD folds the native `cost.total_cost_usd` into a small `daily-cost.json` ledger in the plugin data directory, keyed by `session_id`, and shows the day's cumulative spend as `Today $12.34`. The first sighting of a session records a baseline so only spend from that point counts, the counter resets at local midnight, sessions spanning midnight contribute only the current day's part, and entries unseen for more than 24 hours are dropped so the file stays bounded. It only uses the native field (no estimate fallback), so sessions that never render the statusline are not counted, counting starts when the option is enabled, and totals are per machine. Routed providers (Bedrock/Vertex) are excluded unless `display.showRoutedCost` is also enabled, matching `showCost`.

Official MiniMax Anthropic-compatible endpoints receive a `MiniMax` provider label. MiniMax M2.7 can use its published token and cache prices for local estimates; M3 pricing depends on each request's context tier, which cumulative session tokens cannot safely infer, so ClaudeHUD does not guess an M3 estimate.

`display.showPromptCache` is fully opt-in. When enabled, ClaudeHUD shows **the wall-clock time the session's prompt cache expires** (e.g. `Cache ⏱ until 14:30`), or `expired` once that time has passed. It follows `display.hourCycle` and `display.showClockSeconds` like every other clock time in the HUD. If the transcript has no main-session response yet, the cache element stays hidden.

It shows an expiry time rather than a countdown because the statusline only repaints while Claude Code is active. Between turns — exactly when the cache is draining — a countdown freezes at whatever it last displayed and keeps reporting it; a clock time stays true no matter how stale the render is.

ClaudeHUD detects the cache tier from the transcript when possible. The existing `display.promptCacheTtlSeconds` setting remains a fallback for older or proxied transcripts that do not expose tier details:

- **The TTL is detected.** Every cache write records the tier it used (`usage.cache_creation.ephemeral_5m_input_tokens` vs `ephemeral_1h_input_tokens`), so a 1-hour session counts down against an hour, and a session that changes tier mid-run is followed. Detected values take precedence over the configured fallback.
- **The clock starts at the request**, not at the response it produced, because that is when the cache is read or written. Anchoring on the response would hand the session however long that response took to generate.
- **Subagent responses are ignored.** A subagent runs against its own cache and does not refresh the main session's.

### Usage Limits

Usage display is **enabled by default** when Claude Code provides subscriber `rate_limits` data on stdin. It shows your rate limit consumption on line 2 alongside the context bar.

Set `display.usageValue` to `remaining` to show quota left instead of quota used. Warning colors and 7-day threshold checks still use the underlying used percentage.

ClaudeHUD prefers the official statusline stdin payload for rate-limit windows. If `display.externalUsagePath` points to a fresh local sidecar snapshot, ClaudeHUD can append its `balance_label` alongside stdin windows. If stdin `rate_limits` are missing, the same snapshot can provide fallback usage windows.

The fallback snapshot path must be absolute. The snapshot must be fresh enough (`display.externalUsageFreshnessMs`) and include valid `updated_at`, plus a `five_hour` window, `seven_day` window, `balance_label`, or `model_scoped` array. `balance_label` is optional text for prepaid provider balances; it is trimmed, length-limited, and sanitized before display. Relative paths, invalid JSON, stale files, or invalid timestamps are ignored quietly.

The snapshot may also carry `model_scoped` windows using the same shape Claude Code defines for stdin (`display_name`, `utilization` on the 0-100 scale, ISO `resets_at`). They render exactly like stdin scoped windows (see the model-scoped usage section) and stdin always wins when it carries its own `model_scoped` data. This lets a local feeder surface per-model weekly quotas (e.g. Fable) that the statusline payload does not include yet:

```json
{
  "updated_at": "2026-07-24T14:12:37Z",
  "model_scoped": [
    { "display_name": "Fable", "utilization": 89, "resets_at": "2026-07-27T11:00:00Z" }
  ]
}
```

One zero-credential way to produce such a snapshot is Claude Code's own `get_usage` control request, which returns `rate_limits.model_scoped` without spending tokens; a scheduled job can pipe it through `jq` into the snapshot file. The HUD itself never fetches anything: it only reads the file.

Set `display.externalUsageWritePath` if you want ClaudeHUD to write the official stdin `rate_limits` into a local snapshot for other tools. The path must be absolute, end in `.json`, and live in an existing directory. ClaudeHUD writes the file with private permissions and ignores invalid paths quietly.

Free/weekly-only accounts render the weekly window by itself instead of showing a ghost `5h: --` placeholder.

The 7-day percentage appears when above the `display.sevenDayThreshold` (default 80%):

```
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h) | ██████████ 85% (2d / 7d)
```

To disable, set `display.showUsage` to `false`.

Reset times use relative countdowns by default. Set `display.timeFormat` to `absolute` for wall-clock
times, `both` to show both forms, `elapsed` to show how far through each usage window you are, or
`elapsedAndAbsolute` to show elapsed window progress plus the wall-clock reset time. This setting is
manual-only today; `/claude-hud:configure` preserves it without editing it.

Wall-clock reset times (`absolute`/`both`/`elapsedAndAbsolute`) default to your system locale for 12-
vs 24-hour formatting. Set `display.hourCycle` to `h23` to force 24-hour time regardless of locale, or
to `h12`/`h11` to force 12-hour time with AM/PM. Set `display.showClockSeconds` to `true` to include
seconds in the wall-clock time, e.g. `at 14:30:07`.

Set `display.showResetLabel` to `false` if you want shorter usage countdowns such as `(3h 17m)` instead of `(resets in 3h 17m)`.

Set `display.usageCompact` to `true` if you want the shorter usage-only form, for example `5h: 25% (1h 30m)`. Compact usage takes precedence over `display.usageBarEnabled`.

Set `display.showModelScopedUsage` to `false` to hide the per-model weekly windows (e.g. Fable). The usage line then renders exactly as it would for an account that has none: the 5h/7d windows stay, snapshot windows are hidden along with the stdin ones, and a hidden window no longer counts toward a configured usage threshold, so it can no longer keep the line on screen by itself.

### Security Notes

ClaudeHUD is local-only by design. It does not make network requests, scrape credentials, or call undocumented Claude APIs. It reads the statusline JSON from stdin, the current session transcript path supplied by Claude Code, selected Claude configuration files under `~/.claude`, and git metadata for the current workspace.

HUD cache files are written under `~/.claude/plugins/claude-hud` with private permissions on POSIX filesystems. The cache stores derived display metadata such as context percentages, token counters, activity names, and the resolved Claude Code version.

`--extra-cmd` is disabled unless `CLAUDE_HUD_ALLOW_EXTRA_CMD=1` (or `true`, `yes`, `on`) is present in the HUD process environment. Treat this option as arbitrary code execution: it runs the supplied shell command with your user privileges on statusline refreshes. Do not use commands copied from untrusted sources.

**Requirements:**
- Claude Code must include subscriber `rate_limits` data on stdin for the current session
- Not available for API-key-only users

**Troubleshooting:** If usage doesn't appear:
- Ensure you're logged in with a Claude subscriber account (not API key)
- Check `display.showUsage` is not set to `false` in config
- API users see no usage display (they have pay-per-token, not rate limits)
- AWS Bedrock models display `Bedrock` and hide usage limits (usage is managed in AWS)
- Bedrock and Vertex AI models hide cost estimates by default (billing differs from Anthropic direct); opt in with `display.showRoutedCost`
- Claude Code may leave `rate_limits` empty until after the first model response in a session
- Some Claude Code builds and subscription tiers may still omit `rate_limits`, even after the first response
- If you configured `display.externalUsagePath`, ClaudeHUD will try that local snapshot before hiding usage
- ClaudeHUD never falls back to credential scraping or undocumented API calls

Example fallback snapshot:

```json
{
  "updated_at": "2026-04-20T12:00:00.000Z",
  "five_hour": {
    "used_percentage": 42,
    "resets_at": "2026-04-20T15:00:00.000Z"
  },
  "seven_day": {
    "used_percentage": 84,
    "resets_at": "2026-04-27T12:00:00.000Z"
  }
}
```

### Example Configuration

```json
{
  "language": "zh",
  "lineLayout": "expanded",
  "pathLevels": 2,
  "elementOrder": ["project", "tools", "skills", "mcp", "context", "usage", "memory", "environment", "agents", "todos", "sessionTime"],
  "projectLineOrder": ["project", "model"],
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true,
    "showFileStats": true
  },
  "jjStatus": {
    "enabled": true,
    "showDirty": true,
    "showConflicts": true
  },
  "display": {
    "showTools": true,
    "showSkills": true,
    "showMcp": true,
    "showAgents": true,
    "showTodos": true,
    "showConfigCounts": true,
    "showDuration": true,
    "showMemoryUsage": true
  },
  "colors": {
    "context": "cyan",
    "usage": "cyan",
    "warning": "yellow",
    "usageWarning": "magenta",
    "critical": "red",
    "model": "cyan",
    "project": "yellow",
    "git": "magenta",
    "gitBranch": "cyan",
    "label": "dim",
    "custom": "#FF6600"
  }
}
```

### Display Examples

**1 level (default):** `[Opus] │ my-project git:(main)`

**2 levels:** `[Opus] │ apps/my-project git:(main)`

**3 levels:** `[Opus] │ dev/apps/my-project git:(main)`

**With dirty indicator:** `[Opus] │ my-project git:(main*)`

**With ahead/behind:** `[Opus] │ my-project git:(main ↑2 ↓1)`

**With file stats:** `[Opus] │ my-project git:(main* !3 +1 ?2)`
- `!` = modified files, `+` = added/staged, `✘` = deleted, `?` = untracked
- Counts of 0 are omitted for cleaner display

### Jujutsu (jj) support

Set `jjStatus.enabled` to `true` to opt in. When a real `.jj` directory is found
in (or above) the working directory, the HUD shows jj-native status instead of
git — the two are mutually exclusive per invocation, even in a colocated jj+git
repo. If jj cannot be queried safely, a colocated repository falls back to its
existing git status.

**With a bookmark:** `[Opus] │ my-project jj:(mybookmark)`

**Anonymous change (no bookmark at `@`):** `[Opus] │ my-project jj:(wrulwzyw)`

**Dirty working copy:** `[Opus] │ my-project jj:(mybookmark*)`

**Unresolved conflict:** `[Opus] │ my-project jj:(mybookmark !conflict)`

Ahead/behind counts and per-file change stats are git-only in this version —
jj's equivalent requires more expensive revset queries against
`remote_bookmarks()`, so they're left out to keep the jj status fetch to a
single subprocess call.

The HUD runs jj in prompt-safe, read-only mode: it disables the pager, ignores
the live working copy, and reads the current operation without reconciling it.
That avoids snapshotting files or mutating repository state during statusline
refreshes. As a result, the dirty marker reflects jj's most recent working-copy
snapshot and can remain stale until another jj command records new changes.

### Auto-Refresh

Claude Code only re-runs the statusline after an interaction (a new assistant message, `/compact` finishing, a permission-mode change, or a vim-mode toggle), so time-based HUD info — session duration, usage reset countdowns, the prompt-cache countdown — goes stale between messages. To keep it ticking, add `refreshInterval` (seconds, minimum 1) to the `statusLine` entry in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "...",
    "refreshInterval": 5
  }
}
```

`/claude-hud:setup` offers this during installation. Each refresh re-runs the HUD command, so 5 seconds is a good default; use 1 second only if you want visibly smooth countdowns.

### Disabling the HUD Temporarily

Set the `CLAUDE_HUD_DISABLE` environment variable to launch a session without the HUD — no need to remove the `statusLine` entry from `settings.json`:

```bash
CLAUDE_HUD_DISABLE=1 claude
```

Leaving it unset (or setting an explicit negative: `0`, `false`, `off`, `no`) keeps the HUD enabled. When disabled, the HUD exits immediately without reading the transcript or running git, so the statusline simply stays empty for that session.

### Troubleshooting

**Config not applying?**
- Check for JSON syntax errors: invalid JSON silently falls back to defaults
- Ensure valid values: `pathLevels` must be 1, 2, 3, or `full`; `lineLayout` must be `expanded` or `compact`; `maxWidth` must be a positive number
- Delete config and run `/claude-hud:configure` to regenerate

**Git status missing?**
- Verify you're in a git repository
- Check `gitStatus.enabled` is not `false` in config

**jj status missing, or seeing `git:(...)` in a jj repo?**
- Verify a `.jj` directory exists at or above the working directory
- Set `jjStatus.enabled` to `true` in config (jj support is opt-in)
- Verify the `jj` binary is installed and on `PATH`

**Tool/skill/MCP/agent/todo lines missing?**
- These are hidden by default — enable with `showTools`, `showSkills`, `showMcp`, `showAgents`, `showTodos` in config
- They also only appear when there's activity to show

**HUD not appearing after setup?**
- Send any message — settings reload automatically, but the statusline only renders after your next interaction
- If it still doesn't appear, restart Claude Code (fully quit and run `claude` again) — older Claude Code versions require a restart to pick up statusLine changes
- Make sure `CLAUDE_HUD_DISABLE` is not set in your environment (e.g. exported from a shell profile) — it silences the HUD entirely, including setup verification

---

## Requirements

- Claude Code v1.0.80+
- macOS/Linux: Node.js 18+ or Bun
- Windows: Node.js 18+

---

## Development

```bash
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud
npm ci && npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## 我对 claude-hud 的定制（custom/）

本目录是 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud) 之外的个人定制。
**插件源码一行未改**，全部定制放在插件目录之外，通过两个口子实现：

1. 插件原生配置 `config.json`（0.8.0 起有外部快照接口 `display.externalUsagePath`）。
2. `~/.claude/settings.json` 里的 `statusLine.command`：不再直接跑插件，而是跑自己的 `hud-render.mjs`。它在**同一个 node 进程里** import 插件的 `dist/index.js` 并调用 `main(overrides)`，把 git 状态、配置、stdin 三个依赖换成自己的实现，再把插件输出截下来追加两行。

这样 `claude plugin update claude-hud@claude-hud` 直接升级，定制不用重做。
唯一会破坏定制的是重新执行 `/claude-hud:setup`，它会重写 `statusLine.command`。

### 效果

```
[Fable 5.1] │ C:/workspace_git/documents git:(main) │ 张三 · user@example.com
Context ░░░░░░░░░░ 0% │ Usage ░░░░░░░░░░ 3% (resets in 3h 44m) | Weekly ██░░░░░░░░ 20% (resets in 3d 4h) | Fable Weekly ████░░░░░░ 36% (resets in 3d 4h)
今天是2026年9月9日，农历七月廿八，星期三。
CPU ██░░░░░░░░ 23% 66°C │ RAM ██████░░░░ 63% (20.1 GB / 31.9 GB) │ Swap 1.2 GB
```

日文系统上第三行变为：

```
今日は2026年（令和8年）9月21日（敬老の日）、旧暦8月11日・赤口、月曜日です。
```

终端较窄（`COLUMNS` 小于 `HUD_NARROW_COLS`，默认 150）时整体收缩：第一行只显示当前目录名和账号姓名，进度条只留百分比，括号里去掉 "resets in"，CPU/RAM 行同样去掉进度条：

```
[Fable 5.1] │ documents git:(main) │ 张三
Context 12% │ Usage 11% (4h 24m) | Weekly 16% (1d) | Fable Weekly 29% (1d)
今天是2026年9月13日，农历八月初三，星期日。
CPU 18% │ RAM 99% (15.8 GB / 16.0 GB) │ Swap 0.0 GB
```

### 结构：一个常驻采集进程 + 每次刷新一个渲染进程

```
Claude Code 会话 A ─ statusLine ─▶ node hud-render.mjs ─┐  读 shared/state.json
Claude Code 会话 B ─ statusLine ─▶ node hud-render.mjs ─┤  登记 shared/wanted/<cwd>.json
Claude Code 会话 C ─ statusLine ─▶ node hud-render.mjs ─┘  没心跳就拉起采集进程
                                                        ▲
                node hud-collector.mjs（全机唯一，文件锁） │ 每 5 秒写 state.json
                  CPU/RAM/温度、Fable 周用量、账号标签、各仓库 git 状态
```

- **一次刷新只有一个 node 进程**。渲染进程不起任何子进程：git 结果来自采集进程，终端宽度相关的开关在内存里改，不写 `config.json`。
- **采集进程全机只有一个**，由任意一个会话的渲染进程在发现它没心跳时拉起；10 分钟没有会话登记就自动退出。它对登记的每个仓库用 `fs.watch` 监听工作区，只在有改动或超过 5 分钟时才跑一次 `git status`。
- 为什么这么做：Windows 11 25H2/26H2（26200/26300.9550，2026-09 累积更新后）每创建一个进程就泄漏一个内核 Token 对象直到重启。旧的 bash 包装每次刷新要起二十来个进程（bash 子 shell、find/ls/sort/sed、三个 node、五个 git 和各自的 conhost），8 个会话、15 秒刷新一次时每秒约 10 个进程，一天漏 2～3 GB 分页池。改后每次刷新 4 个进程（Claude Code 自己的两个 bash 和一个 conhost + 一个 node），25 秒内新建进程从约 230 个降到 48 个。

### 文件（custom 目录下）

| 文件 | 作用 |
|------|------|
| `hud-render.mjs` | `statusLine.command` 的唯一入口。读 `shared/state.json`；把本会话 cwd 登记到 `shared/wanted/`；按 `plugins/cache/*/claude-hud/<版本>/dist/index.js` 找到版本号最高的插件（`CLAUDE_HUD_PLUGIN_DIR` 可指定），import 后调用 `main({ readStdin, loadConfig, getGitStatus, log })`：`getGitStatus` 返回采集进程的结果（还没有时只读 `.git/HEAD` 给分支名），`loadConfig` 读完 `config.json` 后按终端宽度在内存里改开关；截下插件输出，窄终端时去掉多出来的 "5h" 标签，再接上日期行和 CPU/RAM 行。`collector.lock` 的 mtime 超过 90 秒就 detached 拉起 `hud-collector.mjs`（多个会话同时发现时靠 `collector.spawn` 时间戳错开，多余的采集进程拿不到锁会自己退出）。采集数据不新鲜时自己算 CPU（`cpu-sample.json` 差值）、省略温度 |
| `hud-collector.mjs` | 常驻采集进程，单例靠 `shared/collector.lock`（内容 pid，mtime 每拍刷新当心跳；锁的 pid 活着且心跳新鲜就退出，活着但心跳过期就接管）。每 5 秒一拍：CPU%（`os.cpus()` 差值）、RAM、Swap、CPU 温度（LibreHardwareMonitor HTTP，没有则每分钟一次 `typeperf` 后台采样，这是它唯一定期起的子进程）；每分钟调一次 `runFeeder()`（Fable 周用量，纯 HTTPS，自带 5 分钟节流）和账号标签检查；对 `shared/wanted/` 里登记的每个目录找仓库根、只读 `.git` 文件取分支名和远端地址，脏状态靠 `git status --porcelain`，只在 `fs.watch` 监听到改动（`.git/` 内只认 HEAD、ORIG_HEAD、MERGE_HEAD、index、packed-refs、refs/）或距上次超过 5 分钟时跑，同一仓库至少隔 10 秒，一拍最多 3 个仓库；`fs.watch` 失败的仓库退化为每分钟查一次。10 分钟没有会话登记就退出。日志 `shared/collector.log`。手动前台运行：`node hud-collector.mjs --foreground` |
| `hud-shared.mjs` | 两者共用：路径常量、`state.json` 原子读写、cwd 归一化与键值、pid 存活检查、找仓库根（含 worktree 的 `.git` 文件）、只读 `.git` 文件的分支名和 GitHub 链接 |
| `sys-usage-line.mjs` | 导出日期行 / CPU/RAM 行的生成函数 `buildExtraLines()` 和按宽度改配置的 `applyWidthToConfig()`，以及 CPU 采样、Swap、温度、系统语言等工具函数；单独 `node sys-usage-line.mjs` 运行时行为和以前一样（输出两行，优先用采集进程的数据）。窄终端（`COLUMNS` 小于 `HUD_NARROW_COLS`）时不画进度条，并把 `display.usageBarEnabled` / `showResetLabel` / `showContextBar`（窄 false）、`pathLevels`（宽 `full`，窄 `1`）、`display.customLine`（宽 "姓名 · 邮箱"，窄只留姓名）改到内存中的配置对象上。日期行跟随系统显示语言：中文系统显示公历 + 农历 + 中国传统节日 + 七色星期；日文系统显示公历 + 令和年号 + 日本祝日（含振替休日、国民の休日）与節分/ひな祭り/七夕/お盆/大晦日 + 旧暦 + 六曜 + 七色星期，旧暦借用 ICU 的中国农历，与日本按 JST 推算的旧暦极少数日子会差一天。语言检测：macOS 读 `defaults read -g AppleLanguages` 首选语言，Windows 读注册表 `HKCU\Control Panel\International\User Profile\Languages`（退回 `LocaleName`），其他平台读 `LC_ALL`/`LC_MESSAGES`/`LANG`；不看进程的 `LANG`，因为 Claude Code 拉起 statusline 时它常是 `en_US.UTF-8`。既非中文也非日文时按中文显示。CPU 温度依次尝试：LibreHardwareMonitor 本机 Web 接口 → Windows 无需管理员的 ACPI 温区性能计数器（`typeperf` 后台采样，缓存在 `acpi-temp.csv`）→ Linux `/sys/class/thermal`；都读不到时静默省略。RAM 颜色：macOS 上 `os.freemem()` 把文件缓存也算成已用，占用率常年 99%，所以改按内核压力等级 `kern.memorystatus_vm_pressure_level` 着色（1 正常 → 蓝，2 警告 → 品红，3/4 紧急/严重 → 红），百分比照常显示；Windows/Linux 或读不到时仍按 ≥75% / ≥90% 着色。RAM 后面附 Swap：macOS 读 `sysctl vm.swapusage`，只显示已用量；Linux 读 `/proc/meminfo`，显示已用 / 总量；Windows 省略。测试日期行：`SYSLINE_DATE=2026-09-25 node sys-usage-line.mjs`，`SYSLINE_LANG=ja` 强制日文 |
| `fable-usage-feeder.mjs` | 导出 `runFeeder({ force })`，调 OAuth usage API（`/api/oauth/usage`），把按模型的周用量（如 Fable）写成 `usage-snapshot.json`，HUD 通过 `display.externalUsagePath` 原生读取。5 分钟内不重复请求，文件锁防并发，结果记 `usage-feeder.log`。凭据优先读 `~/.claude/.credentials.json`（Windows/Linux）；macOS 上该文件通常不存在，改从登录钥匙串的 `Claude Code-credentials` 条目读取（`security find-generic-password`）。手动测试：`node fable-usage-feeder.mjs --force` |
| `account-label.mjs` | 导出 `accountLabelStale()` / `updateAccountLabel()`：`~/.claude.json` 比 `account-label.stamp` 新时（启动 Claude Code 或 `/login` 后），把 `oauthAccount` 的名称、邮箱写到 `account-label.json`，渲染时据此生成 `display.customLine`，HUD 原生渲染在第一行最右侧。API Key 登录或读不到账号时记空值，标签随之清空 |
| `config.json` | HUD 配置。`externalUsagePath` 必须是**绝对路径**（插件不展开 `~`），请把占位符换掉。`customLine` 留空；`customLine`、`pathLevels`、`usageBarEnabled`、`showResetLabel`、`showContextBar` 由 `hud-render.mjs` 按终端宽度在内存里覆盖（文件里的值只是宽终端的默认）；`showDuration` 关闭，第一行最右侧留给账号 |
| `statusline-command.sh` | `statusLine.command` 的可读版本和说明。真正执行的只有最后一行：`"/c/Program Files/nodejs/node.exe" "$HOME/.claude/plugins/claude-hud/hud-render.mjs"` |

环境变量：`COLUMNS` 由 Claude Code 传入（≥ 2.1.153）；`HUD_NARROW_COLS` 窄终端阈值（默认 150，设 `9999` 永远收缩，设 `1` 永远完整）；`CLAUDE_HUD_DISABLE=1` 不输出；`CLAUDE_HUD_PLUGIN_DIR` 指定插件目录。

### 安装

1. 正常安装 claude-hud 插件（>= 0.8.0），并装好 [Node.js](https://nodejs.org/)（>= 20）。
2. 把 `hud-render.mjs`、`hud-collector.mjs`、`hud-shared.mjs`、`sys-usage-line.mjs`、`fable-usage-feeder.mjs`、`account-label.mjs`、`config.json` 放到 `~/.claude/plugins/claude-hud/`，改掉 `config.json` 里的绝对路径。
3. 把 `~/.claude/settings.json` 的 `statusLine` 写成（node 路径按本机改；Windows 下执行命令的是 Git Bash，路径用 `/c/...` 不要用 `C:\...`）：

   ```json
   "statusLine": {
     "type": "command",
     "command": "\"/c/Program Files/nodejs/node.exe\" \"$HOME/.claude/plugins/claude-hud/hud-render.mjs\"",
     "refreshInterval": 15
   }
   ```

   `refreshInterval` 15 秒是 Claude Code 的最小刷新间隔；8 个会话时仍约每 2 秒刷新一次。若机器也受上面说的 Token 泄漏影响，改成 60 可再降到四分之一。
4. 先手动验证：`echo '{"cwd":"<某个仓库>","model":{"display_name":"x"}}' | node ~/.claude/plugins/claude-hud/hud-render.mjs` 应输出 HUD 各行加日期行、CPU/RAM 行；第一次运行会拉起采集进程，`shared/collector.log` 里应出现 `tracking <仓库>`。
5. （可选）CPU 温度：不装任何东西时，Windows 会读 ACPI 温区。温区测的是什么因机器而异：有的机器是主板探头，与 CPU Package 相差 1～3°C；有的笔记本上根本不是 CPU（实测恒定 28°C 左右，而 CPU Package 已到 90°C 以上）。要读真实的 CPU Package 传感器，装 LibreHardwareMonitor：
   - 安装：`winget install LibreHardwareMonitor.LibreHardwareMonitor`（0.9.6 起会连带安装读传感器用的 PawnIO 驱动）。
   - 开启 Web 接口：菜单 Options → Remote Web Server → Run，端口 8085。设置保存在 exe 同目录的 `LibreHardwareMonitor.config`（键 `runWebServerMenuItem`、`listenerPort`）；winget 升级便携包时可能被重置，升级后温度变回 ACPI 值就重新打开。
   - **监听范围**：0.9.6 忽略 `listenerIp`，实际注册 `http://+:8085/`，即所有网卡。"仅本机"靠的是 Windows 防火墙默认阻止入站，不要给 8085 加放行规则。
   - 自启：它需要管理员权限，用提权的计划任务在登录时启动，避免每次开机弹 UAC。可以直接勾选菜单 Options → Run On Windows Startup；自己建任务的话，笔记本记得允许用电池时启动（计划任务默认禁止），并取消运行时长限制。
   - 传感器 ID 因 CPU 而异（例如 `/intelcpu/0/temperature/8` 或 `/4`），找不到固定 ID 时会按名称 `CPU Package` 匹配，不用改脚本。

### 运行时文件（已被 .gitignore 忽略）

脚本运行时会在自己所在目录（安装后即 `~/.claude/plugins/claude-hud/`）生成下列文件，都是缓存或日志，删掉后会自动重建，不需要提交：

| 文件 | 来源 | 内容 |
|------|------|------|
| `shared/state.json` | `hud-collector.mjs` | 每 5 秒一份：`sys`（CPU、温度、内存、Swap）、`git`（按 cwd 键值的仓库状态）、`lang`、会话数、仓库数 |
| `shared/collector.lock` | `hud-collector.mjs` | 单例锁，内容是 pid；mtime 是心跳 |
| `shared/collector.spawn` | `hud-render.mjs` | 上次拉起采集进程的时间戳，10 秒内不重复拉起 |
| `shared/collector.log` | `hud-collector.mjs` | 启动、接管、跟踪仓库、git 失败等记录，超过 64 KB 自动清空 |
| `shared/wanted/<key>.json` | `hud-render.mjs` | 每个会话登记的 cwd（key 是 cwd 的 sha1 前 16 位），3 分钟没刷新视为会话已关闭 |
| `usage-snapshot.json` | `fable-usage-feeder.mjs` | 按模型的用量快照，HUD 通过 `externalUsagePath` 读取 |
| `usage-feeder.log` / `usage-feeder.stamp` / `usage-feeder.lock` | `fable-usage-feeder.mjs` | 每次请求 usage API 的结果、上次请求时间戳、防并发的文件锁 |
| `account-label.json` / `account-label.stamp` | `account-label.mjs` | 当前登录账号的名称和邮箱，以及上次同步的时间戳（删掉可强制重新同步） |
| `cpu-sample.json` | `hud-render.mjs` 兜底路径 | 采集进程数据不新鲜时渲染进程自己算 CPU 用的上一次采样 |
| `acpi-temp.csv` / `acpi-temp.csv.stamp` | `sys-usage-line.mjs` | Windows 下 `typeperf` 采到的 ACPI 温区数据及采样时间戳 |
| `*.tmp` | 各脚本 | 原子写入时的临时文件，正常情况下不会残留 |

### 为什么不用插件自带功能

- Claude Code 传给状态栏的 stdin `rate_limits` 只有合算的 5h/7d，没有按模型的窗口。
- 插件有 `display.showMemoryUsage`，但没有 CPU；`--extra-cmd` 自定义标签只能渲染在第一行，放不到底部。
- 插件的 `display.showAuthUser` 只显示邮箱 `@` 前的部分，有邮箱时不显示名称；`--extra-cmd` 每次渲染都要起一个进程，而账号很少变。所以改成账号变化时写一次标签文件。
- 插件自己的 git 实现每次渲染都起一个 worker 进程和 5 个 git；在 Windows 的 Token 泄漏 bug 下这是最大的进程来源，所以用 `main(overrides)` 的注入口把 `getGitStatus` 换掉。

### 和插件的耦合点（升级插件后先看这里）

`hud-render.mjs` 依赖插件 `dist/` 里三个导出：`index.js` 的 `main(overrides)`（可注入 `readStdin`、`loadConfig`、`getGitStatus`、`log`，输出走 `console.log`）、`config.js` 的 `loadConfig()`、`stdin.js` 的 `readStdin()`。上游改了这些接口时 HUD 会退化成报错行或原样输出，需要对应改 `hud-render.mjs`；临时可用 `CLAUDE_HUD_PLUGIN_DIR` 钉住旧版本目录（插件缓存目录按版本号分开，旧版不会被删）。

### 排障

| 现象 | 先看 |
|------|------|
| `Fable Weekly` 不显示 | `usage-feeder.log`。常见是 accessToken 过期（等 Claude Code 刷新后自动恢复），或快照超过 15 分钟被判过期。macOS：确认钥匙串里有 `Claude Code-credentials` 条目（`security find-generic-password -s "Claude Code-credentials"`），没有就重新 `/login` |
| 底部两行消失 | `statusLine.command` 是否被 `/claude-hud:setup` 重写 |
| 温度一直不显示、CPU 偶尔 `--`、git 脏状态不更新 | 采集进程没在跑：看 `shared/collector.lock` 的修改时间是否在 90 秒内、`shared/collector.log` 末尾；`node hud-collector.mjs --foreground` 前台跑一遍看报错。正常情况下任一会话的下一次刷新会在心跳过期后自动拉起它 |
| 出现多个 `hud-collector.mjs` 进程 | 拿不到锁的会在启动时自己退出；若持续存在，看 `collector.log` 里是否反复 "taking over"（说明心跳写不进去，多半是目录权限或磁盘满） |
| HUD 只剩一行 `[claude-hud] hud-render error: …` 或 `plugin not found` | 插件没装、缓存目录名变了，或上游改了 `main(overrides)` 接口。`CLAUDE_HUD_PLUGIN_DIR` 指到正确目录试试 |
| HUD 完全不显示（Windows） | 执行 statusLine 的是 Git Bash：命令里不能有 `C:\...` 反斜杠路径（会被吃成 `C:...`），用 `/c/...`；把 settings.json 里的命令原样喂给 `bash -c` 看报错 |
| 账号不显示 / 换号后没更新 | 删掉 `account-label.stamp`，等采集进程下一分钟重新同步；先看 `account-label.json` 里有没有名称和邮箱 |
| 温度明显偏低且几乎不变（如 28°C） | LibreHardwareMonitor 没在运行或 Web 接口没开，退回了 ACPI 温区，而这台机器的温区不是 CPU。`curl http://127.0.0.1:8085/data.json` 看是否有响应 |
| 农历缺失 | 运行时 ICU 不带中文日历时脚本静默省略农历，只显示公历和星期 |
| 进度条时有时无、路径或账号忽长忽短 / 想固定 | 这是按 `COLUMNS` 自动切换的（阈值 `HUD_NARROW_COLS`，默认 150）。要永远用完整样式设成 1，永远用收缩样式设成 9999 |
| 日期行语言不对 | `SYSLINE_LANG=ja node sys-usage-line.mjs` 能出日文说明脚本正常，是系统语言没读到：macOS 看 `defaults read -g AppleLanguages` 第一项，Windows 看 `reg query "HKCU\Control Panel\International\User Profile" /v Languages`。也可以在 statusLine 命令里直接 `export SYSLINE_LANG=ja` 固定 |
| 想确认每次刷新到底起了几个进程 | PowerShell：`Get-CimInstance Win32_Process | ? { $_.CreationDate -gt (Get-Date).AddSeconds(-25) } | group Name`，正常只有 bash、conhost、node 三种 |

### 为什么仓库根目录是插件 0.8.0 的快照

根目录下除 `custom/` 以外的内容，是 2026-10-25 从 `~/.claude/plugins/cache/claude-hud/claude-hud/0.8.0/` 原样复制的上游插件 0.8.0（含编译好的 `dist/`，只去掉了运行时标记 `.in_use/`）。

留这份快照的原因：`custom/hud-render.mjs` 依赖插件 `dist/index.js` 导出的 `main(overrides)`，上游从 0.10.0（提交 027c0de）起删掉了这个参数，0.9 以后的版本直接升级会让定制脚本失效。新装机器或插件缓存被清掉时，把本仓库（不含 `custom/`）放回 `~/.claude/plugins/cache/claude-hud/claude-hud/0.8.0/`，或用 `CLAUDE_HUD_PLUGIN_DIR` 指向本仓库目录即可。不要把插件 marketplace 指向本仓库：`.claude-plugin/marketplace.json` 里登记的是上游地址，`claude plugin update` 仍应走上游。
