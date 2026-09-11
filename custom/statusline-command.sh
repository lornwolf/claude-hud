#!/usr/bin/env bash
# 写入 ~/.claude/settings.json 的 statusLine.command（实际存放时压成一行）：
#
#   "statusLine": { "type": "command", "command": "<下面这段，压成一行>", "refreshInterval": 15 }
#
# 每次刷新要起 2～3 个 node 进程，在双核低压 CPU 上约 2 秒；refreshInterval 设 5 负载偏高，15 足够。
# 有交互（新消息、工具调用等）时 Claude Code 仍会立即刷新，定时器只影响空闲时的倒计时和 CPU/RAM。
#
# Claude Code 本身就用 bash 执行这段命令，直接放进去即可，不要再套一层 bash -c '...'。
# Windows 上装了 Git for Windows 后执行者是 Git Bash：路径写成 /c/... 形式，
# 反斜杠路径（C:\...）会被 bash 吃掉，HUD 静默不显示。
#
# 四步：
#   1. usage-feeder.stamp 不存在或超过 4 分钟，就在后台拉起一次 fable-usage-feeder.mjs（不阻塞渲染；
#      </dev/null 让它不占用 HUD 要读的 stdin）
#   2. ~/.claude.json 比 account-label.stamp 新（启动 Claude Code 或 /login 后）才运行一次
#      account-label.mjs，把账号写进 config.json 的 customLine；平时只是一次 bash 内建的 -nt 比较
#   3. 自动选版本号最高的插件缓存目录，运行 claude-hud 本体
#   4. 追加运行 sys-usage-line.mjs，输出底部的日期行和 CPU/RAM 行
#
# 运行时二选一（custom/ 下的脚本两者都能跑）：
#   node: RUN="/c/Program Files/nodejs/node.exe"  ENTRY=dist/index.js   node 不能直接跑 .ts
#   bun : RUN="$HOME/.bun/bin/bun"                ENTRY=src/index.ts

hud="$HOME/.claude/plugins/claude-hud"
RUN="/c/Program Files/nodejs/node.exe"
ENTRY=dist/index.js

if [ ! -f "$hud/usage-feeder.stamp" ] || [ -n "$(find "$hud/usage-feeder.stamp" -mmin +4 2>/dev/null)" ]; then
  ("$RUN" "$hud/fable-usage-feeder.mjs" </dev/null >/dev/null 2>&1 &)
fi

if [ ! -f "$hud/account-label.stamp" ] || [ "${CLAUDE_CONFIG_DIR:-$HOME/.claude}.json" -nt "$hud/account-label.stamp" ]; then
  "$RUN" "$hud/account-label.mjs" </dev/null >/dev/null 2>&1
fi

# 终端宽度：Claude Code >= 2.1.153 会传入 COLUMNS，老版本退回 stty / 120；减 4 是输入框两侧的留白
cols=${COLUMNS:-}
case "$cols" in ""|*[!0-9]*) cols=$(stty size 2>/dev/null </dev/tty | awk '{print $2}');; esac
case "$cols" in ""|*[!0-9]*) cols=120;; esac
export COLUMNS=$(( cols > 4 ? cols - 4 : 1 ))

# sort -V 做版本号排序，避免 awk 嵌套单引号在 Git Bash 下出错（上游 issue #326）
plugin_dir=$(ls -1d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | sort -V | tail -1)

"$RUN" "${plugin_dir}${ENTRY}"
"$RUN" "$hud/sys-usage-line.mjs"
