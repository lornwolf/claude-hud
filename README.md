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
CPU ██░░░░░░░░ 23% 66°C │ RAM ██████░░░░ 63% (20.1 GB / 31.9 GB)
```

## 文件（custom 目录下）

| 文件 | 作用 |
|------|------|
| `fable-usage-feeder.mjs` | 调 OAuth usage API（`/api/oauth/usage`），把按模型的周用量（如 Fable）写成 `usage-snapshot.json`，HUD 通过 `display.externalUsagePath` 原生读取。5 分钟内不重复请求，文件锁防并发，结果记 `usage-feeder.log`。手动测试：`node fable-usage-feeder.mjs --force`（bun 亦可） |
| `account-label.mjs` | 把当前登录账号（`~/.claude.json` 的 `oauthAccount`：名称 · 邮箱）写进 `config.json` 的 `display.customLine`，HUD 原生渲染在第一行最右侧，渲染时零开销。只在 `~/.claude.json` 比 `account-label.stamp` 新时（启动 Claude Code 或 `/login` 后）由 statusLine 命令调起，账号没变不改文件；API Key 登录或读不到账号时清空 |
| `sys-usage-line.mjs` | 在 HUD 之后追加两行：日期行（公历 + 农历 + 中国传统节日 + 七色星期）和 CPU/RAM 行。CPU 温度依次尝试：LibreHardwareMonitor 本机 Web 接口 → Windows 无需管理员的 ACPI 温区性能计数器（`typeperf` 后台采样，缓存在 `acpi-temp.csv`，30 秒刷新一次）→ Linux `/sys/class/thermal`；都读不到时静默省略。测试日期行：`SYSLINE_DATE=2026-09-25 node sys-usage-line.mjs` |
| `config.json` | HUD 配置。`externalUsagePath` 必须是**绝对路径**（插件不展开 `~`），请把占位符换掉。`customLine` 留空，由 `account-label.mjs` 自动维护（手动改会被覆盖）；`showDuration` 关闭，第一行最右侧留给账号 |
| `statusline-command.sh` | `statusLine.command` 的可读版本（settings.json 里是一行），运行时可选 node 或 bun |

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

## 为什么不用插件自带功能

- Claude Code 传给状态栏的 stdin `rate_limits` 只有合算的 5h/7d，没有按模型的窗口。
- 插件有 `display.showMemoryUsage`，但没有 CPU；`--extra-cmd` 自定义标签只能渲染在第一行，放不到底部。
- 插件的 `display.showAuthUser` 只显示邮箱 `@` 前的部分，有邮箱时不显示名称；`--extra-cmd` 每次渲染都要起一个进程，而账号很少变。所以改成账号变化时写一次 `customLine`。

## 排障

| 现象 | 先看 |
|------|------|
| `Fable Weekly` 不显示 | `usage-feeder.log`。常见是 accessToken 过期（等 Claude Code 刷新后自动恢复），或快照超过 15 分钟被判过期 |
| 底部两行消失 | `statusLine.command` 是否被 `/claude-hud:setup` 重写 |
| HUD 完全不显示（Windows） | 执行 statusLine 的是 Git Bash：命令里不能有 `C:\...` 反斜杠路径（会被吃成 `C:...`），用 `/c/...`；把 settings.json 里的命令原样喂给 `bash -c` 看报错 |
| 账号不显示 / 换号后没更新 | 删掉 `account-label.stamp`，下次刷新即重新同步；再看 `config.json` 的 `display.customLine` |
| CPU 显示 `--` | 首次渲染无上次采样，下一次即正常 |
| 温度明显偏低且几乎不变（如 28°C） | LibreHardwareMonitor 没在运行或 Web 接口没开，退回了 ACPI 温区，而这台机器的温区不是 CPU。`curl http://127.0.0.1:8085/data.json` 看是否有响应 |
| 温度不显示 | Windows：首次渲染缓存为空属正常，第二次起显示；`acpi-temp.csv` 里没有数据说明本机没有 `Thermal Zone Information` 计数器。Linux：`/sys/class/thermal` 下没有温区 |
| 农历缺失 | 运行时 ICU 不带中文日历时脚本静默省略农历，只显示公历和星期 |
