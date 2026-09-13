# custom/ —— 我对 claude-hud 的定制

本目录是 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud) 之外的个人定制。
**插件源码一行未改**，全部定制放在插件目录之外，通过两个口子实现：

1. 插件原生配置 `config.json`（0.8.0 起有外部快照接口 `display.externalUsagePath`）。
2. `~/.claude/settings.json` 里 `statusLine.command` 的 bash 包装：在调用 HUD 前后做别的事、追加输出。

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
Context 12% │ Usage 5h 11% (4h 24m) | Weekly 16% (1d) | Fable Weekly 29% (1d)
今天是2026年9月13日，农历八月初三，星期日。
CPU 18% │ RAM 99% (15.8 GB / 16.0 GB) │ Swap 0.0 GB
```

## 文件（custom 目录下）

| 文件 | 作用 |
|------|------|
| `fable-usage-feeder.mjs` | 调 OAuth usage API（`/api/oauth/usage`），把按模型的周用量（如 Fable）写成 `usage-snapshot.json`，HUD 通过 `display.externalUsagePath` 原生读取。5 分钟内不重复请求，文件锁防并发，结果记 `usage-feeder.log`。凭据优先读 `~/.claude/.credentials.json`（Windows/Linux）；macOS 上该文件通常不存在，改从登录钥匙串的 `Claude Code-credentials` 条目读取（`security find-generic-password`）。手动测试：`node fable-usage-feeder.mjs --force`（bun 亦可） |
| `account-label.mjs` | 把当前登录账号（`~/.claude.json` 的 `oauthAccount`：名称、邮箱）记到 `account-label.json`，`sys-usage-line.mjs` 每轮据此写 `config.json` 的 `display.customLine`（宽终端 "姓名 · 邮箱"，窄终端只留姓名），HUD 原生渲染在第一行最右侧。只在 `~/.claude.json` 比 `account-label.stamp` 新时（启动 Claude Code 或 `/login` 后）由 statusLine 命令调起，账号没变不改文件；API Key 登录或读不到账号时记空值，标签随之清空 |
| `sys-usage-line.mjs` | 追加两行：日期行和 CPU/RAM 行。还负责按终端宽度收缩：`COLUMNS` 小于 `HUD_NARROW_COLS`（默认 150，即四段带 10 格进度条的用量行宽度）时自己不画进度条，并在 HUD 本体运行前把 `display.usageBarEnabled` / `showResetLabel` / `showContextBar`（窄 false）、`pathLevels`（宽 `full` 全路径，窄 `1` 只留当前目录名）、`display.customLine`（宽 "姓名 · 邮箱"，窄只留姓名）同步进 `config.json`（只在值变化时改写，改 mtime 让插件的配置缓存失效），所以 statusLine 命令里它先于 HUD 运行、输出暂存到最后打印。这些项由脚本托管，手动改会被覆盖；设 `HUD_NARROW_COLS=9999` 可永远使用收缩样式，设 `1` 永远使用完整样式。日期行跟随系统显示语言：中文系统显示公历 + 农历 + 中国传统节日 + 七色星期；日文系统显示公历 + 令和年号 + 日本祝日（含振替休日、国民の休日）与節分/ひな祭り/七夕/お盆/大晦日 + 旧暦 + 六曜 + 七色星期，旧暦借用 ICU 的中国农历，与日本按 JST 推算的旧暦极少数日子会差一天。语言检测：macOS 读 `defaults read -g AppleLanguages` 首选语言，Windows 读注册表 `HKCU\Control Panel\International\User Profile\Languages`（退回 `LocaleName`），其他平台读 `LC_ALL`/`LC_MESSAGES`/`LANG`；不看进程的 `LANG`，因为 Claude Code 拉起 statusline 时它常是 `en_US.UTF-8`。既非中文也非日文时按中文显示。CPU 温度依次尝试：LibreHardwareMonitor 本机 Web 接口 → Windows 无需管理员的 ACPI 温区性能计数器（`typeperf` 后台采样，缓存在 `acpi-temp.csv`，30 秒刷新一次）→ Linux `/sys/class/thermal`；都读不到时静默省略。RAM 颜色：macOS 上 `os.freemem()` 把文件缓存也算成已用，占用率常年 99%，所以改按内核压力等级 `kern.memorystatus_vm_pressure_level` 着色（1 正常 → 蓝，2 警告 → 品红，3/4 紧急/严重 → 红，即活动监视器压力图的绿/黄/红），百分比照常显示；Windows/Linux 或读不到时仍按 ≥75% / ≥90% 着色。RAM 后面附 Swap：macOS 读 `sysctl vm.swapusage`，只显示已用量（总量按需增长，没有参考意义）；Linux 读 `/proc/meminfo`，显示已用 / 总量；Windows 省略。已用为 0 时暗色，否则沿用 RAM 的颜色，压力高时一起变红。测试日期行：`SYSLINE_DATE=2026-09-25 node sys-usage-line.mjs`，`SYSLINE_LANG=ja` 强制日文 |
| `config.json` | HUD 配置。`externalUsagePath` 必须是**绝对路径**（插件不展开 `~`），请把占位符换掉。`customLine` 留空；`customLine`、`pathLevels`、`usageBarEnabled`、`showResetLabel`、`showContextBar` 由 `sys-usage-line.mjs` 按终端宽度维护（手动改都会被覆盖，账号信息改在 `~/.claude.json` 里由 `account-label.mjs` 读取）；`showDuration` 关闭，第一行最右侧留给账号 |
| `statusline-command.sh` | `statusLine.command` 的可读版本（settings.json 里是一行），运行时可选 node 或 bun。`HUD_NARROW_COLS` 在这里设置；`sys-usage-line.mjs` 先跑并暂存输出，HUD 本体后跑，改动顺序会让宽度切换晚一轮生效 |

## 安装

1. 正常安装 claude-hud 插件（>= 0.8.0），并装好 [Node.js](https://nodejs.org/) 或 [bun](https://bun.sh)。Windows 用 node：插件的 `/claude-hud:setup` 在 Windows 上也只支持 node。
2. 把 `fable-usage-feeder.mjs`、`sys-usage-line.mjs`、`account-label.mjs`、`config.json` 放到 `~/.claude/plugins/claude-hud/`，改掉 `config.json` 里的绝对路径。
3. 按 `statusline-command.sh` 选好 `RUN` / `ENTRY`，压成一行写入 `~/.claude/settings.json` 的 `statusLine.command`（不要再套 `bash -c '...'`；用 JSON 序列化工具写，别手拼引号）。
4. （可选）CPU 温度：不装任何东西时，Windows 会读 ACPI 温区。温区测的是什么因机器而异：有的机器是主板探头，与 CPU Package 相差 1～3°C；有的笔记本上根本不是 CPU（实测恒定 28°C 左右，而 CPU Package 已到 90°C 以上）。要读真实的 CPU Package 传感器，装 LibreHardwareMonitor：
   - 安装：`winget install LibreHardwareMonitor.LibreHardwareMonitor`（0.9.6 起会连带安装读传感器用的 PawnIO 驱动）。
   - 开启 Web 接口：菜单 Options → Remote Web Server → Run，端口 8085。设置保存在 exe 同目录的 `LibreHardwareMonitor.config`（键 `runWebServerMenuItem`、`listenerPort`）；winget 升级便携包时可能被重置，升级后温度变回 ACPI 值就重新打开。
   - **监听范围**：0.9.6 忽略 `listenerIp`，实际注册 `http://+:8085/`，即所有网卡。"仅本机"靠的是 Windows 防火墙默认阻止入站，不要给 8085 加放行规则。
   - 自启：它需要管理员权限，用提权的计划任务在登录时启动，避免每次开机弹 UAC。可以直接勾选菜单 Options → Run On Windows Startup；自己建任务的话，笔记本记得允许用电池时启动（计划任务默认禁止），并取消运行时长限制。
   - 传感器 ID 因 CPU 而异（例如 `/intelcpu/0/temperature/8` 或 `/4`），`sys-usage-line.mjs` 找不到固定 ID 时会按名称 `CPU Package` 匹配，不用改脚本。

## 运行时文件（已被 .gitignore 忽略）

脚本运行时会在自己所在目录（安装后即 `~/.claude/plugins/claude-hud/`）旁边生成下列文件，都是缓存或日志，删掉后下次渲染会自动重建，不需要提交：

| 文件 | 来源 | 内容 |
|------|------|------|
| `usage-snapshot.json` | `fable-usage-feeder.mjs` | 按模型的用量快照，HUD 通过 `externalUsagePath` 读取 |
| `usage-feeder.log` | `fable-usage-feeder.mjs` | 每次请求 usage API 的结果，排障先看这里 |
| `usage-feeder.stamp` / `usage-feeder.lock` | `fable-usage-feeder.mjs` | 上次请求时间戳，以及防并发的文件锁 |
| `account-label.stamp` | `account-label.mjs` | 上次同步账号的时间戳，删掉可强制重新同步 |
| `account-label.json` | `account-label.mjs` | 当前登录账号的名称和邮箱，供 `sys-usage-line.mjs` 生成 `customLine` |
| `cpu-sample.json` | `sys-usage-line.mjs` | 上一次 CPU 采样，用于算两次渲染之间的使用率 |
| `acpi-temp.csv` / `acpi-temp.csv.stamp` | `sys-usage-line.mjs` | Windows 下 `typeperf` 采到的 ACPI 温区数据及采样时间戳 |
| `*.tmp` | 各脚本 | 原子写入时的临时文件，正常情况下不会残留 |

## 为什么不用插件自带功能

- Claude Code 传给状态栏的 stdin `rate_limits` 只有合算的 5h/7d，没有按模型的窗口。
- 插件有 `display.showMemoryUsage`，但没有 CPU；`--extra-cmd` 自定义标签只能渲染在第一行，放不到底部。
- 插件的 `display.showAuthUser` 只显示邮箱 `@` 前的部分，有邮箱时不显示名称；`--extra-cmd` 每次渲染都要起一个进程，而账号很少变。所以改成账号变化时写一次 `customLine`。

## 排障

| 现象 | 先看 |
|------|------|
| `Fable Weekly` 不显示 | `usage-feeder.log`。常见是 accessToken 过期（等 Claude Code 刷新后自动恢复），或快照超过 15 分钟被判过期。macOS：确认钥匙串里有 `Claude Code-credentials` 条目（`security find-generic-password -s "Claude Code-credentials"`），没有就重新 `/login` |
| 底部两行消失 | `statusLine.command` 是否被 `/claude-hud:setup` 重写 |
| HUD 完全不显示（Windows） | 执行 statusLine 的是 Git Bash：命令里不能有 `C:\...` 反斜杠路径（会被吃成 `C:...`），用 `/c/...`；把 settings.json 里的命令原样喂给 `bash -c` 看报错 |
| 账号不显示 / 换号后没更新 | 删掉 `account-label.stamp`，下次刷新即重新同步；先看 `account-label.json` 里有没有名称和邮箱，再看 `config.json` 的 `display.customLine` |
| CPU 显示 `--` | 首次渲染无上次采样，下一次即正常 |
| 温度明显偏低且几乎不变（如 28°C） | LibreHardwareMonitor 没在运行或 Web 接口没开，退回了 ACPI 温区，而这台机器的温区不是 CPU。`curl http://127.0.0.1:8085/data.json` 看是否有响应 |
| 温度不显示 | Windows：首次渲染缓存为空属正常，第二次起显示；`acpi-temp.csv` 里没有数据说明本机没有 `Thermal Zone Information` 计数器。Linux：`/sys/class/thermal` 下没有温区 |
| 农历缺失 | 运行时 ICU 不带中文日历时脚本静默省略农历，只显示公历和星期 |
| 进度条时有时无、路径或账号忽长忽短 / 想固定 | 这是按 `COLUMNS` 自动切换的（阈值 `HUD_NARROW_COLS`，默认 150）。要永远用完整样式设成 1，永远用收缩样式设成 9999；改完 settings.json 里的命令后下一次刷新生效 |
| 日期行语言不对 | `SYSLINE_LANG=ja node sys-usage-line.mjs` 能出日文说明脚本正常，是系统语言没读到：macOS 看 `defaults read -g AppleLanguages` 第一项，Windows 看 `reg query "HKCU\Control Panel\International\User Profile" /v Languages`。也可以在 statusLine 命令里直接 `export SYSLINE_LANG=ja` 固定 |
