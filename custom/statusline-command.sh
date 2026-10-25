#!/usr/bin/env bash
# 写入 ~/.claude/settings.json 的 statusLine.command：
#
#   "statusLine": {
#     "type": "command",
#     "command": "\"/c/Program Files/nodejs/node.exe\" \"$HOME/.claude/plugins/claude-hud/hud-render.mjs\"",
#     "refreshInterval": 15
#   }
#
# 2026-10 起 statusLine 命令只剩这一行：Claude Code 用 Git Bash 执行它，bash 再起一个 node 跑
# hud-render.mjs，一次刷新就这一个 node 进程（加上 Claude Code 自己的 bash 启动器和 conhost，共 4 个）。
# 以前的包装脚本每次刷新要起二十来个进程（bash 子 shell、find/ls/sort/sed、三个 node、五个 git
# 和各自的 conhost），在 Windows 11 26H2 的内核 Token 泄漏 bug 下一天漏 2～3 GB 分页池。
#
# 分工：
#   hud-render.mjs     每次刷新跑一次。读 shared/state.json，把本会话 cwd 登记到 shared/wanted/，
#                      在同一进程里 import 插件 dist/ 各模块，经 hud-pipeline.mjs 复刻插件 main() 的流程（插件
#                      0.10.0 起 main() 不再接受注入）：git 状态用采集
#                      进程的结果、按终端宽度在内存里改 config 开关（不再改写 config.json）、截下
#                      输出去掉窄终端多出来的 "5h" 标签，最后接上日期行和 CPU/RAM 行。
#                      采集进程没在跑（collector.lock 的 mtime 超过 90 秒）就 detached 拉起一个。
#   hud-collector.mjs  常驻单例（文件锁）。每 5 秒：CPU/RAM/温度采样、每分钟一次 runFeeder()
#                      （Fable 周用量，纯 HTTPS）、账号标签、对登记的每个仓库用 fs.watch 监听工作区，
#                      有改动或超过 5 分钟才跑一次 git status。10 分钟没有会话登记就退出。
#   hud-pipeline.mjs   唯一和插件耦合的文件，对照上游 src/index.ts 的 main() 维护（当前 0.13.0）
#   hud-shared.mjs     两者共用：路径、state.json 读写、只读 .git 文件的分支名/远端地址。
#   sys-usage-line.mjs / fable-usage-feeder.mjs / account-label.mjs  变成模块被上面两个调用，
#                      直接 node 运行时行为和以前一样。
#
# 环境变量：COLUMNS 由 Claude Code 传入（≥2.1.153）；HUD_NARROW_COLS 窄终端阈值（默认 150，
# 设 9999 永不画进度条）；CLAUDE_HUD_DISABLE=1 不输出；CLAUDE_HUD_PLUGIN_DIR 指定插件目录
# （默认取 plugins/cache/*/claude-hud/ 下版本号最高的）。
#
# 本文件只是说明；真正执行的就是下面这一行。

"/c/Program Files/nodejs/node.exe" "$HOME/.claude/plugins/claude-hud/hud-render.mjs"
