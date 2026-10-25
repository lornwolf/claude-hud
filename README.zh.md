# Claude HUD

一个 Claude Code 插件，常驻在输入框下方，实时显示上下文用量、使用率限制、正在运行的工具、子代理以及待办进度。


[![License](https://img.shields.io/github/license/lornwolf/claude-hud?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/lornwolf/claude-hud)](https://github.com/lornwolf/claude-hud/stargazers)

![Claude HUD 运行效果](claude-hud-preview-5-2.png)

> 🌐 [English](README.md) | 中文文档

## 安装

在 Claude Code 中运行：

```
/plugin marketplace add lornwolf/claude-hud
/plugin install claude-hud
/reload-plugins
/claude-hud:setup
```

`/claude-hud:setup` 会把状态栏指向 HUD。Claude Code 会自动重新加载设置，HUD 会立即出现。想要自定义，直接告诉 Claude，或运行 `/claude-hud:configure`。

<details>
<summary><strong>更喜欢用终端？</strong></summary>

```bash
claude plugin marketplace add lornwolf/claude-hud
claude plugin install claude-hud@claude-hud
```

然后在会话中运行 `/reload-plugins` 和 `/claude-hud:setup`。

</details>

<details>
<summary><strong>Windows：setup 提示找不到 JavaScript 运行时</strong></summary>

安装 Node.js LTS（`winget install OpenJS.NodeJS.LTS`），重启 shell，然后再次运行 `/claude-hud:setup`。

</details>

**更新：** 默认情况下，Claude Code 不会自动更新第三方插件。要开启自动更新，运行 `/plugin`，打开 **Marketplaces**，选择 **claude-hud**，然后选择 **Enable auto-update**。如果没有这个选项，或者收不到更新，可以在终端中手动更新：

```bash
claude plugin marketplace update claude-hud
claude plugin update claude-hud@claude-hud
```

然后在已打开的会话中运行 `/reload-plugins`。无需再次运行 setup。

## 显示效果

默认显示两行：

```
[Opus] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (resets in 1h 30m)
```

- **第 1 行**：模型、检测到时的提供商标签（`Bedrock`、`Vertex`、`MiniMax`）、项目路径和 git 分支。
- **第 2 行**：上下文用量（随占用依次变为绿、黄、红）以及订阅用户的使用率限制。

可选行，通过 `/claude-hud:configure` 开启：

```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← 工具
◐ explore [haiku]: Finding auth code (2m 15s)    ← 子代理
▸ Fix authentication bug (2/5)                   ← 待办
```

## 工作原理

Claude HUD 是一个[状态栏](https://code.claude.com/docs/en/statusline)命令。Claude Code 通过 stdin 传入会话数据（模型、上下文窗口、费用、使用率限制、prompt cache）并显示它的输出。部分可选元素（例如工具、子代理和待办行）还会读取会话 transcript。不需要单独的窗口或 tmux，任何终端都能用。

## 配置

```
/claude-hud:configure
```

引导流程涵盖布局、活动行、会话信息、使用率、git、语言和自定义行。保存前会预览改动，并保留它没有询问的所有设置。

其他设置位于 `~/.claude/plugins/claude-hud/config.json`（或 `$CLAUDE_CONFIG_DIR` 下）。无效值会回退为默认值。

如果多个 `CLAUDE_CONFIG_DIR` 共用同一个 `plugins/` 目录，可以把各目录专属的设置放进 `$CLAUDE_CONFIG_DIR/claude-hud.json`。它的结构相同，只需写要改的键，加载时叠加在共享配置之上：

```json
{ "display": { "customLine": "Work Team" } }
```

标签语言支持英文（默认）、简体中文（`zh-Hans`，别名 `zh`）和繁体中文（`zh-Hant`，别名 `zh-TW`）。

### 选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `language` | `en` \| `zh` \| `zh-Hans` \| `zh-Hant` \| `zh-TW` | `en` | HUD 标签语言。设为 `zh` 或 `zh-Hans` 启用简体中文，设为 `zh-Hant` 或 `zh-TW` 启用繁体中文 |
| `lineLayout` | string | `expanded` | 布局：`expanded`（多行）或 `compact`（单行） |
| `showSeparators` | boolean | false | 在 `compact` 布局中，在会话行与活动行之间画一条分隔线 |
| `pathLevels` | 1-3 \| `full` | 1 | 项目路径显示的目录层级数，或设为 `full` 显示完整绝对路径 |
| `maxWidth` | number \| `null` | `null` | 可选的回退宽度，仅在终端宽度检测完全失败时使用 |
| `forceMaxWidth` | boolean | false | 当设置了 `maxWidth` 时始终使用它，即使终端宽度检测返回更小的值 |
| `elementOrder` | string[] | `["project","addedDirs","context","usage","promptCache","cacheHitRate","memory","environment","tools","skills","mcp","agents","todos","sessionTime"]` | 展开模式下元素的顺序。省略的条目在展开模式下隐藏。现有配置会保留其显式顺序直到更新。`sessionTokens` 不在默认顺序中：加入后即可像其他元素一样放置 `display.showSessionTokens` 的摘要，例如与 `project` 放进同一个 `display.mergeGroups` 分组。未加入时，它仍单独显示在最后一行。`cost` 同理：未加入时，费用仍显示在第一行（可用 `projectLineOrder` 调整位置）；加入后，它成为独立元素，例如在 `elementOrder` 中依次放入 `"context","usage","cost"`，并在 `display.mergeGroups` 中使用 `["context","usage","cost"]`，即可把它放在上下文和用量旁边。 |
| `projectLineOrder` | string[] | `[]` | 可选的首行片段前置顺序，适用于两种布局。可见性仍由 `display.show*` 控制；省略的片段保持渲染器原有顺序。例如 `["project","model"]` 会将项目和 Git 放到模型徽标之前 |
| `display.mergeGroups` | string[][] | `[["context","usage"]]` | 展开模式下相邻时应共享一行的元素分组。设为 `[]` 可禁用合并行 |
| `display.rightAlign` | string[] | `[]` | 以合并行中第一个列出的元素作为右对齐后缀的起点，保持 `elementOrder` 并用空格填充间隔。锚点必须位于实际合并渲染的 `display.mergeGroups` 分组中。终端宽度未知、锚点位于首位或空间不足时回退到普通的 ` │ ` 连接。示例：分组为 `["project","context","usage"]` 时设为 `["context"]`，项目/git 保持在左侧，context 与 usage 靠右对齐。 |
| `gitStatus.enabled` | boolean | true | 在 HUD 中显示 git 分支 |
| `gitStatus.showDirty` | boolean | true | 显示 `*` 表示未提交的更改 |
| `gitStatus.showAheadBehind` | boolean | false | 显示 `↑N ↓N` 表示领先/落后远程的提交数 |
| `gitStatus.pushWarningThreshold` | number | 0 | 当未推送提交数达到此值时，用警告色显示 ahead 计数（`0` 表示禁用） |
| `gitStatus.pushCriticalThreshold` | number | 0 | 当未推送提交数达到此值时，用严重色显示 ahead 计数（`0` 表示禁用） |
| `gitStatus.showFileStats` | boolean | false | 显示文件变更数量 `!M +A ✘D ?U` |
| `gitStatus.showWorktree` | boolean | false | 在关联的 git worktree 中，于分支后显示其名称，例如 `git:(feat/x) ⎇ feat-x` |
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | 保持当前截断行为，或在可能时让 git 块以自己的换行边界单独换到下一行 |
| `jjStatus.enabled` | boolean | false | 显式启用 jj（Jujutsu）状态。启用后若找到真实的 `.jj` 目录，该仓库将显示 jj 而不是 git，二者不会同时运行 |
| `jjStatus.showDirty` | boolean | true | 当 jj 工作副本提交与其父提交不同时显示 `*` |
| `jjStatus.showConflicts` | boolean | true | 当 jj 工作副本提交包含未解决冲突时显示 `!conflict` |
| `display.showModel` | boolean | true | 显示模型名称 `[Opus]` |
| `display.showProject` | boolean | true | 显示项目路径 |
| `display.modelSource` | `stdin` \| `auto` \| `transcript` | `stdin` | 控制模型名称来源。`stdin` 保持默认行为；`auto` 仅在 transcript 返回非 Claude 模型时切换，用于检测代理路由；`transcript` 始终使用 API 响应中的模型。Transcript 模型值会清理终端转义字符并截断为 80 个字符 |
| `display.modelFormat` | `full` \| `compact` \| `short` | `full` | `compact` 去掉 `(1M context)` 这类上下文窗口后缀；`short` 还会去掉开头的 `Claude ` |
| `display.modelOverride` | string | `""` | 用这段文字代替模型名称（最多 80 个字符） |
| `display.showProvider` | boolean | false | 在模型名称*之前*显示提供商标签，例如 `[Bedrock \| Opus 4.6]`。自定义代理提供同名模型时有用。关闭时，自动检测的提供商仍跟在模型后面 |
| `display.providerName` | string | `""` | 与 `display.showProvider` 一起使用的显式提供商标签，例如无法自动检测的自定义代理。为空时回退到自动检测（Bedrock/Vertex/MiniMax/Enterprise）；上限 40 字符 |
| `display.showAddedDirs` | boolean | true | 显示来自 `/add-dir` 的额外工作区目录（如 `+sparkle +lib-foo`）；空数组不显示任何内容。在两种布局中最多渲染 5 个目录（溢出显示为 `+N more`），基名截断为 24 个字符并加 `…` |
| `display.addedDirsLayout` | `inline` \| `line` | `inline` | `inline` 将目录放在项目名称旁边，每个目录带 `+name` 前缀；`line` 在单独的 `Added dirs: name1, name2` 行渲染（无 `+` 前缀，逗号分隔） |
| `display.showContextBar` | boolean | true | 显示可视化上下文进度条 `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | 上下文显示格式（`45%`、`45k/200k`、剩余 `55%` 或 `45% (45k/200k)`） |
| `display.autoCompactWindow` | number \| `null` | `null` | 设为正数（如 `200000`）时，按此自动压缩窗口而不是完整模型上下文窗口计算上下文百分比，以匹配 `/context`。留空或 `null` 保持默认全窗口行为 |
| `display.showConfigCounts` | boolean | false | 显示 CLAUDE.md、rules、MCPs、hooks 数量 |
| `display.environmentThreshold` | number | 0 | 配置计数总和达到此值前隐藏（0 = 始终显示） |
| `display.showCost` | boolean | false | 显示 Claude Code 上报的会话费用（`cost.total_cost_usd`） |
| `display.showRoutedCost` | boolean | false | 同时为 Bedrock 和 Vertex 会话显示费用。它们通过云服务商计费，因此 `showCost` 默认隐藏其费用。需同时开启 `showCost` |
| `display.showDailyCost` | boolean | false | 显示当天跨会话累计花费，格式为 `Today $12.34`，从原生 `cost.total_cost_usd` 写入插件数据目录中的按日账本。本地午夜重置。与 `showCost` 独立 |
| `display.showWeeklyCost` | boolean | false | 显示自每周额度窗口开始以来的累计花费，格式为 `Week $123.45`，与 `showDailyCost` 使用同一账本。仅订阅用户可用：需要 7 天用量窗口 |
| `display.showOutputStyle` | boolean | false | 显示当前输出风格，格式为 `style: <名称>` |
| `display.showDuration` | boolean | false | 显示会话已运行的时长，例如 `⏱️ 5m` |
| `display.showSpeed` | boolean | false | 显示最近一次响应的输出 Token 速度 `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | 显示 Claude 订阅用户的使用率限制（可用时） |
| `display.usageValue` | `percent` \| `remaining` | `percent` | 使用率显示格式（已使用 `25%`，或剩余 `75%`） |
| `display.usageBarEnabled` | boolean | true | 将使用率显示为可视化进度条而非文本 |
| `display.usageCompact` | boolean | false | 以较短的文本形式显示使用率，如 `5h: 25% (1h 30m)`；优先于 `display.usageBarEnabled` |
| `display.showResetLabel` | boolean | true | 在使用率倒计时前显示 `resets in` 前缀 |
| `display.showModelScopedUsage` | boolean | true | 显示按模型每周窗口（`model_scoped`，例如 Fable），无论其来自 stdin 还是外部用量快照。设为 `false` 后，使用率行的渲染效果等同于负载中本就没有这些窗口 |
| `display.usagePace` | boolean | false | 当使用率窗口按当前速度会在重置前用尽时，以琥珀色或红色显示并标记 `▲` |
| `display.timeFormat` | `relative` \| `absolute` \| `both` \| `elapsed` \| `elapsedAndAbsolute` | `relative` | 控制使用率窗口时间的显示方式：仅倒计时（`resets in 2h 30m`）、墙钟重置时间（`resets at 14:30`）、两者同时显示、窗口已过百分比（`53% elapsed`），或已过百分比加墙钟重置时间 |
| `display.hourCycle` | `auto` \| `h11` \| `h12` \| `h23` \| `h24` | `auto` | 墙钟重置时间（`absolute`/`both`/`elapsedAndAbsolute` 模式）的时制。`auto` 跟随系统区域设置；`h23` 强制使用 24 小时制（`14:30`），不受区域设置影响 |
| `display.showClockSeconds` | boolean | false | 在墙钟重置时间中显示秒数，如 `at 14:30:07` |
| `display.usageThreshold` | 0-100 | 0 | 任一窗口达到此百分比前隐藏使用率（0 = 始终显示） |
| `display.sevenDayThreshold` | 0-100 | 80 | 当 7 天使用率 ≥ 阈值时显示（0 = 始终显示） |
| `display.externalUsagePath` | string | `""` | 可选的本地使用率快照文件**绝对路径**。支持开头的 `~` 和 `${VAR}`。相对路径会被忽略。stdin `rate_limits` 存在时会附加 `balance_label`，并在 stdin 缺少 `model_scoped` 窗口时用快照补齐；stdin 窗口缺失时可整体作为回退 |
| `display.externalUsageWritePath` | string | `""` | 可选的绝对 `.json` 路径，父目录必须已存在。支持开头的 `~` 和 `${VAR}`。当 stdin `rate_limits` 存在时，ClaudeHUD 会写入私有权限快照供其他本地工具读取。相对路径、非 json 文件和缺失父目录会被忽略 |
| `display.externalUsageFreshnessMs` | number | `300000` | 外部使用率快照允许的最长存活时间，超时后会被忽略 |
| `display.showTokenBreakdown` | boolean | true | 在高上下文时（85%+）显示 Token 详情 |
| `display.contextWarningThreshold` | 0-100 | 70 | 上下文进度条变为警告色的百分比 |
| `display.contextCriticalThreshold` | 0-100 | 85 | 上下文进度条变为严重色并显示 token 明细的百分比 |
| `display.showTools` | boolean | false | 显示工具活动行 |
| `display.showSkills` | boolean | false | 显示从 `Skill` 工具调用检测到的活动 Skills |
| `display.showMcp` | boolean | false | 显示从 `mcp__server__tool` 调用检测到的活动 MCP 服务器 |
| `display.toolNameMaxLength` | number | `0` | 工具名称最大显示长度。`0` 保留完整名称；截断 MCP 名称时可能缩短为最后一段 |
| `display.toolsMaxVisible` | number | `4` | 工具行最多显示的已完成工具数。`0` 表示不限制 |
| `display.skillsMaxVisible` | number | `4` | Skills 行在 `+N more` 之前最多显示的 Skill 名称数。`0` 表示不限制 |
| `display.showAgents` | boolean | false | 显示 Agent 活动行 |
| `display.showTodos` | boolean | false | 显示待办进度行 |
| `display.showSessionName` | boolean | false | 显示会话名称：`/rename` 设置的名称，或 Claude Code 生成的标题 |
| `display.showSessionTokens` | boolean | false | 显示本会话累计的 token 总量，例如 `Tokens 262k (in: 6k, out: 2k, cache: 254k)` |
| `display.showAuth` | boolean | false | 在第一行末尾显示当前登录的认证方式（订阅计划），例如 `Claude Max 20x`。来自 `~/.claude.json`（或覆盖配置目录时的 `$CLAUDE_CONFIG_DIR/.claude.json`）的 `oauthAccount`；无 OAuth 但设置了 `ANTHROPIC_API_KEY` 时显示 `API Key` |
| `display.showAuthUser` | boolean | false | 在认证方式旁显示已登录账号（邮箱本地部分，回退到资料显示名） |
| `display.authUserLength` | number | `8` | 账号名截断前的最大字符数，超出以 `…` 截断。`0` 显示全名 |
| `display.showAdvisor` | boolean | false | 在 project 行内联显示 Claude Code `/advisor` 配置的顾问模型，例如 `Advisor: Opus 4.7`。来自 Claude Code 写入每条 assistant transcript 记录的 `advisorModel` 字段；渲染前会做控制字符/双向标记/ANSI 过滤并截断到 64 字符 |
| `display.advisorOverride` | string | `""` | 手动覆盖顾问显示文本。非空时优先于 transcript 检测，同样会做过滤和截断 |
| `display.showSessionStartDate` | boolean | false | 显示 transcript 会话开始时间戳 |
| `display.showLastResponseAt` | boolean | false | 显示最后一次 assistant 响应写入的时间距现在多久 |
| `display.showCompactions` | boolean | false | 显示本会话已发生的上下文压缩次数（手动 `/compact` 或自动压缩），从 transcript 的 `compact_boundary` 记录计数，例如 `压缩次数: 2`。第一次压缩前不显示 |
| `display.showEffortLevel` | boolean | false | 在模型徽章中显示当前推理力度。Ultracode 渲染为 `ultracode(xhigh)`，从会话 transcript 检测，因此能跟踪运行时的 `/effort` 变更 |
| `display.effortFormat` | `full` \| `symbol` \| `text` | `full` | `showEffortLevel` 开启时的渲染方式：符号加级别文本（`◑ high`）、仅符号（`◑`）、或仅级别文本（`high`）。`symbol` 下 Ultracode 仍保持完整的 `◕ ultracode(xhigh)`，以免丢失标记；没有已知符号的级别回退到级别文本 |
| `display.showAgentEffort` | boolean | false | 配合 `display.showAgents`，在每个子 Agent 的模型旁显示其推理力度，例如 `◐ code-reviewer [haiku-4.5 ◔ medium]`，格式遵循 `display.effortFormat`。从子 Agent 自己的 transcript 读取，因此要等 Claude Code 记录下该 Agent 的 id（后台 Agent 在启动时，其他 Agent 在结束时）且它已有第一条回复后才会出现 |
| `display.showClaudeCodeVersion` | boolean | false | 显示当前运行的 Claude Code 版本，如 `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | 在展开布局中显示近似系统 RAM 使用行 |
| `display.showPromptCache` | boolean | false | 显示主会话 prompt cache 的过期时刻 |
| `display.showCacheHitRate` | boolean | false | 以 `Cache hit X%` 形式显示本会话的 prompt cache 命中率 |
| `display.customLine` | string | `""` | 显示在第一行的自定义文字（最多 80 个字符） |
| `display.customLinePosition` | `first` \| `last` | `last` | 自定义文字放在第一行的开头还是结尾 |
| `colors.context` | 颜色值 | `green` | 上下文进度条和百分比的基础颜色 |
| `colors.usage` | 颜色值 | `brightBlue` | 使用率进度条和低于警告阈值时百分比的颜色 |
| `colors.warning` | 颜色值 | `yellow` | 上下文阈值和使用率警告文本的警告颜色 |
| `colors.usageWarning` | 颜色值 | `brightMagenta` | 使用率进度条和接近阈值时百分比的警告颜色 |
| `colors.critical` | 颜色值 | `red` | 达到限制状态和严重阈值的颜色 |
| `colors.model` | 颜色值 | `cyan` | 模型徽章颜色，如 `[Opus]` |
| `colors.project` | 颜色值 | `yellow` | 项目路径的颜色 |
| `colors.git` | 颜色值 | `magenta` | Git 包装文本的颜色，如 `git:(` 和 `)` |
| `colors.gitBranch` | 颜色值 | `cyan` | Git 分支和分支状态文本的颜色 |
| `colors.label` | 颜色值 | `dim` | 标签和次要元数据的颜色，如 `Context`、`Usage`、计数和进度文本 |
| `colors.custom` | 颜色值 | `208` | 可选自定义行的颜色 |
| `colors.barFilled` | string | `█` | 进度条填充部分使用的字符 |
| `colors.barEmpty` | string | `░` | 进度条空白部分使用的字符 |

颜色可以是名称（`dim`、`red`、`green`、`yellow`、`magenta`、`cyan`、`brightBlue`、`brightMagenta`）、256 色编号（`0-255`）或十六进制（`#rrggbb`）。`colors.barFilled` 和 `colors.barEmpty` 只接受单个可见字符；emoji 等宽字符在部分终端中可能影响进度条对齐。

### 使用率限制

只要 Claude Code 发送了订阅用户的 `rate_limits`（会话中首个响应之后），就会显示使用率。API key、Bedrock 和 Vertex 会话没有订阅用户限额，因此不显示。7 天窗口在超过 `display.sevenDayThreshold` 后出现：

```
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (resets in 1h 30m) | Weekly █████████░ 85% (resets in 1d)
```

开启 `display.usagePace` 后，消耗快于恢复的窗口会变为琥珀色（预计用到 90% 及以上）或红色（预计在重置前用尽），并加上 `▲`。已用低于 10% 的窗口保持中性。

**外部快照。** `display.externalUsagePath` 读取一个本地 JSON 文件。stdin 没有窗口数据时由它补上，它的 `balance_label` 或 `model_scoped` 窗口（例如按模型的每周额度）会附加到 stdin 的数据上。路径必须是绝对路径，且文件要比 `display.externalUsageFreshnessMs` 新：

```json
{
  "updated_at": "2026-04-20T12:00:00.000Z",
  "five_hour": { "used_percentage": 42, "resets_at": "2026-04-20T15:00:00.000Z" },
  "seven_day": { "used_percentage": 84, "resets_at": "2026-04-27T12:00:00.000Z" },
  "balance_label": "¥6.35",
  "model_scoped": [{ "display_name": "Fable", "utilization": 89, "resets_at": "2026-04-27T11:00:00Z" }]
}
```

`display.externalUsageWritePath` 则反过来：把 stdin 的使用率限制写入一个已存在目录中的私有 `.json` 文件，供其他工具读取。

### 费用

`display.showCost` 显示 Claude Code 自己计算的会话费用（按标价，或使用你的 `modelPricing` 表）。Bedrock 和 Vertex 通过云服务商计费，因此除非同时设置 `display.showRoutedCost`，否则不显示它们的费用。

`display.showDailyCost` 会加上今天所有会话的花费（`Today $12.34`）。它记录在插件数据目录中的一个小账本里，在本地午夜重置，并从首次看到该会话的渲染开始计数。`display.showWeeklyCost` 使用同一个账本，从 7 天额度窗口的开始计数，因此需要订阅用户会话。

### Prompt Cache

`display.showPromptCache` 显示主会话 prompt cache 何时失效，例如 `Cache ⏱ until 14:30`，或 `expired`。它显示时刻而不是倒计时：状态栏在两个回合之间不会重绘，而那正是缓存流失的时候；时刻无论渲染多旧都仍然正确。`display.showCacheHitRate` 显示从缓存读取的输入 token 占比。

### Jujutsu（jj）

把 `jjStatus.enabled` 设为 `true`，在含有 `.jj` 仓库的目录中会显示 jj 状态（例如 `jj:(mybookmark*)` 或 `jj:(wrulwzyw !conflict)`）而不是 git。HUD 以只读方式运行 jj，不会对工作副本做快照，因此脏标记反映的是 jj 最近一次快照。领先/落后计数和文件统计仅适用于 git。

### 示例

```json
{
  "lineLayout": "expanded",
  "pathLevels": 2,
  "gitStatus": { "showAheadBehind": true, "showFileStats": true },
  "display": {
    "showTools": true,
    "showAgents": true,
    "showTodos": true,
    "showDuration": true,
    "showCost": true
  },
  "colors": { "context": "cyan", "custom": "#FF6600" }
}
```

### 自动刷新

Claude Code 会在每条消息、`/compact`、权限或 vim 模式变化、使用率窗口重置以及 prompt cache 失效之后重新运行状态栏。若想在会话空闲时让倒计时和时长继续走动，在 `~/.claude/settings.json` 的 `statusLine` 中加上 `refreshInterval`（秒）。

### 临时关闭

```bash
CLAUDE_HUD_DISABLE=1 claude
```

除 `0`、`false`、`off`、`no` 之外的任何值都会在该会话中清空 HUD，无需修改 `settings.json`。

## 安全

Claude HUD 只在本地运行。它不发起网络请求，从不读取凭据，也不调用未公开的 API。它读取 Claude Code 的 stdin、会话 transcript、Claude 配置文件以及当前目录的 git 或 jj 元数据。它唯一写入的是 `~/.claude/plugins/claude-hud` 下的少量状态文件（输出速度和费用账本），并使用私有权限。

`--extra-cmd` 会在每次刷新时运行一条 shell 命令，并把输出显示在第一行。除非 HUD 的环境中设置了 `CLAUDE_HUD_ALLOW_EXTRA_CMD=1`，否则它会被忽略。请把它视为任意代码执行，切勿使用来源不可信的命令。

## 故障排查

**HUD 没有出现。** 发送一条消息，状态栏会在交互之后渲染。确认 shell 中没有设置 `CLAUDE_HUD_DISABLE`。如果 Node 或 Bun 的路径变了（例如 nvm 或 mise 升级之后），重新运行 `/claude-hud:setup`。

**配置没有生效。** 检查 JSON 是否有语法错误：无效文件会回退为默认值。确认取值在范围内，选项表中列出了各项范围。

**没有显示使用率。** 使用率需要以 Claude 订阅用户身份登录，并在首个响应之后出现。检查 `display.showUsage`。

**没有 git 或 jj 状态。** 确认当前位于仓库中，并且开启了 `gitStatus.enabled`（或 `jjStatus.enabled`，且 `jj` 在 `PATH` 中）。

**缺少某个活动行。** 工具、子代理、待办、技能和 MCP 行默认关闭，并且只在有活动时显示。

## 运行环境要求

- Claude Code v2.1.260 或更高版本
- macOS 或 Linux：Node.js 18+ 或 Bun
- Windows：Node.js 18+

## 开发

```bash
git clone https://github.com/lornwolf/claude-hud
cd claude-hud
npm ci && npm test
```

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT，参见 [LICENSE](LICENSE)。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=lornwolf/claude-hud&type=Date)](https://star-history.com/#lornwolf/claude-hud&Date)

---

## 我对 claude-hud 的定制（custom/）

`custom/` 是我在插件本体之外做的定制。**插件源码一行未改**，全部定制都放在 `custom/` 里，通过两个口子实现：

1. 插件原生配置 `config.json`（0.8.0 起有外部快照接口 `display.externalUsagePath`）。
2. `~/.claude/settings.json` 里的 `statusLine.command`：不再直接跑插件，而是跑自己的 `hud-render.mjs`。它在**同一个 node 进程里** import 插件 `dist/` 里的各个模块，由 `hud-pipeline.mjs` 复刻插件 `main()` 的流程并把 git 状态、配置、stdin 三个依赖换成自己的实现（插件 0.10.0 起 `main()` 不再接受注入），再把插件输出截下来追加两行。

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
| `hud-render.mjs` | `statusLine.command` 的唯一入口。读 `shared/state.json`；把本会话 cwd 登记到 `shared/wanted/`；按 `plugins/cache/*/claude-hud/<版本>/dist/index.js` 找到版本号最高的插件（`CLAUDE_HUD_PLUGIN_DIR` 可指定），交给 `hud-pipeline.mjs` 的 `runHud(pluginDir, overrides)` 运行，注入 `readStdin`、`loadConfig`、`getGitStatus`、`log`：`getGitStatus` 返回采集进程的结果（还没有时只读 `.git/HEAD` 给分支名），`loadConfig` 读完 `config.json` 后按终端宽度在内存里改开关；截下插件输出，窄终端时去掉多出来的 "5h" 标签，再接上日期行和 CPU/RAM 行。`collector.lock` 的 mtime 超过 90 秒就 detached 拉起 `hud-collector.mjs`（多个会话同时发现时靠 `collector.spawn` 时间戳错开，多余的采集进程拿不到锁会自己退出）。采集数据不新鲜时自己算 CPU（`cpu-sample.json` 差值）、省略温度 |
| `hud-pipeline.mjs` | 和插件耦合的唯一文件。`loadPlugin(dir)` import 插件 `dist/` 里要用的模块，`runHud(dir, overrides)` 按 `src/index.ts` 的 `main()` 复刻流程（对照版本 0.13.0），`overrides` 可注入 `readStdin`、`loadConfig`、`getGitStatus`、`getUsageFromStdin`、`parseTranscript`、`log`，也可以是 `(plugin) => overrides` 的函数以便拿到插件原版实现 |
| `hud-collector.mjs` | 常驻采集进程，单例靠 `shared/collector.lock`（内容 pid，mtime 每拍刷新当心跳；锁的 pid 活着且心跳新鲜就退出，活着但心跳过期就接管）。每 5 秒一拍：CPU%（`os.cpus()` 差值）、RAM、Swap、CPU 温度（LibreHardwareMonitor HTTP，没有则每分钟一次 `typeperf` 后台采样，这是它唯一定期起的子进程）；每分钟调一次 `runFeeder()`（Fable 周用量，纯 HTTPS，自带 5 分钟节流）和账号标签检查；对 `shared/wanted/` 里登记的每个目录找仓库根、只读 `.git` 文件取分支名和远端地址，脏状态靠 `git status --porcelain`，只在 `fs.watch` 监听到改动（`.git/` 内只认 HEAD、ORIG_HEAD、MERGE_HEAD、index、packed-refs、refs/）或距上次超过 5 分钟时跑，同一仓库至少隔 10 秒，一拍最多 3 个仓库；`fs.watch` 失败的仓库退化为每分钟查一次。10 分钟没有会话登记就退出。日志 `shared/collector.log`。手动前台运行：`node hud-collector.mjs --foreground` |
| `hud-shared.mjs` | 两者共用：路径常量、`state.json` 原子读写、cwd 归一化与键值、pid 存活检查、找仓库根（含 worktree 的 `.git` 文件）、只读 `.git` 文件的分支名和 GitHub 链接 |
| `sys-usage-line.mjs` | 导出日期行 / CPU/RAM 行的生成函数 `buildExtraLines()` 和按宽度改配置的 `applyWidthToConfig()`，以及 CPU 采样、Swap、温度、系统语言等工具函数；单独 `node sys-usage-line.mjs` 运行时行为和以前一样（输出两行，优先用采集进程的数据）。窄终端（`COLUMNS` 小于 `HUD_NARROW_COLS`）时不画进度条，并把 `display.usageBarEnabled` / `showResetLabel` / `showContextBar`（窄 false）、`pathLevels`（宽 `full`，窄 `1`）、`display.customLine`（宽 "姓名 · 邮箱"，窄只留姓名）改到内存中的配置对象上。日期行跟随系统显示语言：中文系统显示公历 + 农历 + 中国传统节日 + 七色星期；日文系统显示公历 + 令和年号 + 日本祝日（含振替休日、国民の休日）与節分/ひな祭り/七夕/お盆/大晦日 + 旧暦 + 六曜 + 七色星期，旧暦借用 ICU 的中国农历，与日本按 JST 推算的旧暦极少数日子会差一天。语言检测：macOS 读 `defaults read -g AppleLanguages` 首选语言，Windows 读注册表 `HKCU\Control Panel\International\User Profile\Languages`（退回 `LocaleName`），其他平台读 `LC_ALL`/`LC_MESSAGES`/`LANG`；不看进程的 `LANG`，因为 Claude Code 拉起 statusline 时它常是 `en_US.UTF-8`。既非中文也非日文时按中文显示。CPU 温度依次尝试：LibreHardwareMonitor 本机 Web 接口 → Windows 无需管理员的 ACPI 温区性能计数器（`typeperf` 后台采样，缓存在 `acpi-temp.csv`）→ Linux `/sys/class/thermal`；都读不到时静默省略。RAM 颜色：macOS 上 `os.freemem()` 把文件缓存也算成已用，占用率常年 99%，所以改按内核压力等级 `kern.memorystatus_vm_pressure_level` 着色（1 正常 → 蓝，2 警告 → 品红，3/4 紧急/严重 → 红），百分比照常显示；Windows/Linux 或读不到时仍按 ≥75% / ≥90% 着色。RAM 后面附 Swap：macOS 读 `sysctl vm.swapusage`，只显示已用量；Linux 读 `/proc/meminfo`，显示已用 / 总量；Windows 省略。测试日期行：`SYSLINE_DATE=2026-09-25 node sys-usage-line.mjs`，`SYSLINE_LANG=ja` 强制日文 |
| `fable-usage-feeder.mjs` | 导出 `runFeeder({ force })`，调 OAuth usage API（`/api/oauth/usage`），把按模型的周用量（如 Fable）写成 `usage-snapshot.json`，HUD 通过 `display.externalUsagePath` 原生读取。5 分钟内不重复请求，文件锁防并发，结果记 `usage-feeder.log`。凭据优先读 `~/.claude/.credentials.json`（Windows/Linux）；macOS 上该文件通常不存在，改从登录钥匙串的 `Claude Code-credentials` 条目读取（`security find-generic-password`）。手动测试：`node fable-usage-feeder.mjs --force` |
| `account-label.mjs` | 导出 `accountLabelStale()` / `updateAccountLabel()`：`~/.claude.json` 比 `account-label.stamp` 新时（启动 Claude Code 或 `/login` 后），把 `oauthAccount` 的名称、邮箱写到 `account-label.json`，渲染时据此生成 `display.customLine`，HUD 原生渲染在第一行最右侧。API Key 登录或读不到账号时记空值，标签随之清空 |
| `config.json` | HUD 配置。`externalUsagePath` 必须是**绝对路径**（插件不展开 `~`），请把占位符换掉。`customLine` 留空；`customLine`、`pathLevels`、`usageBarEnabled`、`showResetLabel`、`showContextBar` 由 `hud-render.mjs` 按终端宽度在内存里覆盖（文件里的值只是宽终端的默认）；`showDuration` 关闭，第一行最右侧留给账号 |
| `statusline-command.sh` | `statusLine.command` 的可读版本和说明。真正执行的只有最后一行：`"/c/Program Files/nodejs/node.exe" "$HOME/.claude/plugins/claude-hud/hud-render.mjs"` |

环境变量：`COLUMNS` 由 Claude Code 传入（≥ 2.1.153）；`HUD_NARROW_COLS` 窄终端阈值（默认 150，设 `9999` 永远收缩，设 `1` 永远完整）；`CLAUDE_HUD_DISABLE=1` 不输出；`CLAUDE_HUD_PLUGIN_DIR` 指定插件目录。

### 安装

1. 正常安装 claude-hud 插件（0.13.0，即本仓库根目录的版本；`claude plugin update claude-hud@claude-hud` 可把缓存更到最新），并装好 [Node.js](https://nodejs.org/)（>= 20）。
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
- 插件自己的 git 实现每次渲染都起一个 worker 进程和 5 个 git；在 Windows 的 Token 泄漏 bug 下这是最大的进程来源，所以在 `hud-pipeline.mjs` 里把 `getGitStatus` 换掉。采集进程跑 git 时和插件 0.11.1 的安全修复一样关掉仓库自己的 `core.fsmonitor` 和 filter 驱动，并用 `diff-index` 代替 `diff` 以免留下 `index.lock`。

### 和插件的耦合点（升级插件后先看这里）

`custom/hud-pipeline.mjs` 是唯一和插件耦合的文件：它 import 插件 `dist/` 里的 stdin.js、config.js、transcript.js、render/index.js、render/activity.js、config-reader.js、git.js、jj.js、extra-cmd.js、memory.js、auth.js、daily-cost.js、speed.js、external-usage.js、i18n/index.js，按 `src/index.ts` 的 `main()` 复刻流程（对照版本 0.13.0）。插件本体升级后先 `git diff <旧版本> <新版本> -- src/index.ts`，有改动就同步到 `hud-pipeline.mjs`，再跑一次 `echo '{"cwd":"<repo>","model":{"display_name":"x"}}' | CLAUDE_HUD_PLUGIN_DIR=$PWD node custom/hud-render.mjs`，输出里不能有 `[claude-hud] Error:`。临时可用 `CLAUDE_HUD_PLUGIN_DIR` 钉住旧版本目录（插件缓存目录按版本号分开，旧版不会被删）。

### 排障

| 现象 | 先看 |
|------|------|
| `Fable Weekly` 不显示 | `usage-feeder.log`。常见是 accessToken 过期（等 Claude Code 刷新后自动恢复），或快照超过 15 分钟被判过期。macOS：确认钥匙串里有 `Claude Code-credentials` 条目（`security find-generic-password -s "Claude Code-credentials"`），没有就重新 `/login` |
| 底部两行消失 | `statusLine.command` 是否被 `/claude-hud:setup` 重写 |
| 温度一直不显示、CPU 偶尔 `--`、git 脏状态不更新 | 采集进程没在跑：看 `shared/collector.lock` 的修改时间是否在 90 秒内、`shared/collector.log` 末尾；`node hud-collector.mjs --foreground` 前台跑一遍看报错。正常情况下任一会话的下一次刷新会在心跳过期后自动拉起它 |
| 出现多个 `hud-collector.mjs` 进程 | 拿不到锁的会在启动时自己退出；若持续存在，看 `collector.log` 里是否反复 "taking over"（说明心跳写不进去，多半是目录权限或磁盘满） |
| HUD 只剩一行 `[claude-hud] hud-render error: …` 或 `plugin not found` | 插件没装、缓存目录名变了，或插件本体改了 `hud-pipeline.mjs` 依赖的导出。`CLAUDE_HUD_PLUGIN_DIR` 指到正确目录试试 |
| HUD 完全不显示（Windows） | 执行 statusLine 的是 Git Bash：命令里不能有 `C:\...` 反斜杠路径（会被吃成 `C:...`），用 `/c/...`；把 settings.json 里的命令原样喂给 `bash -c` 看报错 |
| 账号不显示 / 换号后没更新 | 删掉 `account-label.stamp`，等采集进程下一分钟重新同步；先看 `account-label.json` 里有没有名称和邮箱 |
| 温度明显偏低且几乎不变（如 28°C） | LibreHardwareMonitor 没在运行或 Web 接口没开，退回了 ACPI 温区，而这台机器的温区不是 CPU。`curl http://127.0.0.1:8085/data.json` 看是否有响应 |
| 农历缺失 | 运行时 ICU 不带中文日历时脚本静默省略农历，只显示公历和星期 |
| 进度条时有时无、路径或账号忽长忽短 / 想固定 | 这是按 `COLUMNS` 自动切换的（阈值 `HUD_NARROW_COLS`，默认 150）。要永远用完整样式设成 1，永远用收缩样式设成 9999 |
| 日期行语言不对 | `SYSLINE_LANG=ja node sys-usage-line.mjs` 能出日文说明脚本正常，是系统语言没读到：macOS 看 `defaults read -g AppleLanguages` 第一项，Windows 看 `reg query "HKCU\Control Panel\International\User Profile" /v Languages`。也可以在 statusLine 命令里直接 `export SYSLINE_LANG=ja` 固定 |
| 想确认每次刷新到底起了几个进程 | PowerShell：`Get-CimInstance Win32_Process | ? { $_.CreationDate -gt (Get-Date).AddSeconds(-25) } | group Name`，正常只有 bash、conhost、node 三种 |

### 仓库布局与部署

根目录是插件本体（含编译好的 `dist/`，可直接作为插件目录使用），`custom/` 是定制脚本，两者放在同一个仓库里一起演进。插件本体有改动时的部署顺序：

1. 按上面「和插件的耦合点」检查 `hud-pipeline.mjs`，用 `CLAUDE_HUD_PLUGIN_DIR=$PWD` 跑一遍 `custom/hud-render.mjs` 确认没有 `[claude-hud] Error:`。
2. `claude plugin update claude-hud@claude-hud` 让插件缓存更到同一版本（`hud-render.mjs` 自动选版本号最高的缓存目录；旧版本目录会保留，出问题时可用 `CLAUDE_HUD_PLUGIN_DIR` 钉回去）。
3. `custom/*.mjs` 复制到 `~/.claude/plugins/claude-hud/`。
4. 杀掉旧的 `hud-collector.mjs`，下一次刷新会自动拉起新代码的采集进程。

新装机器或插件缓存被清掉时，也可以直接用 `CLAUDE_HUD_PLUGIN_DIR` 指向本仓库目录，不经过插件缓存。
