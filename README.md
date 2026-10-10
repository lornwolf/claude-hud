# custom/ —— 我对 claude-hud 的定制

本目录是 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud) 之外的个人定制。
**插件源码一行未改**，全部定制放在插件目录之外，通过两个口子实现：

1. 插件原生配置 `config.json`（0.8.0 起有外部快照接口 `display.externalUsagePath`）。
2. `~/.claude/settings.json` 里的 `statusLine.command`：不再直接跑插件，而是跑自己的 `hud-render.mjs`。它在**同一个 node 进程里** import 插件的 `dist/index.js` 并调用 `main(overrides)`，把 git 状态、配置、stdin 三个依赖换成自己的实现，再把插件输出截下来追加两行。

这样 `claude plugin update claude-hud@claude-hud` 直接升级，定制不用重做。
唯一会破坏定制的是重新执行 `/claude-hud:setup`，它会重写 `statusLine.command`。

## 效果

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

## 结构：一个常驻采集进程 + 每次刷新一个渲染进程

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

## 文件（custom 目录下）

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

## 安装

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

## 运行时文件（已被 .gitignore 忽略）

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

## 为什么不用插件自带功能

- Claude Code 传给状态栏的 stdin `rate_limits` 只有合算的 5h/7d，没有按模型的窗口。
- 插件有 `display.showMemoryUsage`，但没有 CPU；`--extra-cmd` 自定义标签只能渲染在第一行，放不到底部。
- 插件的 `display.showAuthUser` 只显示邮箱 `@` 前的部分，有邮箱时不显示名称；`--extra-cmd` 每次渲染都要起一个进程，而账号很少变。所以改成账号变化时写一次标签文件。
- 插件自己的 git 实现每次渲染都起一个 worker 进程和 5 个 git；在 Windows 的 Token 泄漏 bug 下这是最大的进程来源，所以用 `main(overrides)` 的注入口把 `getGitStatus` 换掉。

## 和插件的耦合点（升级插件后先看这里）

`hud-render.mjs` 依赖插件 `dist/` 里三个导出：`index.js` 的 `main(overrides)`（可注入 `readStdin`、`loadConfig`、`getGitStatus`、`log`，输出走 `console.log`）、`config.js` 的 `loadConfig()`、`stdin.js` 的 `readStdin()`。上游改了这些接口时 HUD 会退化成报错行或原样输出，需要对应改 `hud-render.mjs`；临时可用 `CLAUDE_HUD_PLUGIN_DIR` 钉住旧版本目录（插件缓存目录按版本号分开，旧版不会被删）。

## 排障

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
