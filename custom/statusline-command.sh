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
#   3. 先运行 sys-usage-line.mjs 并暂存输出：它会按终端宽度把进度条 / "resets in" 的开关同步进
#      config.json，必须在 HUD 本体之前跑，本轮才能生效
#   4. 自动选版本号最高的插件缓存目录，运行 claude-hud 本体（窄终端时经 sed 去掉多出来的 "5h" 标签），
#      最后打印暂存的日期行和 CPU/RAM 行
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

# 窄终端阈值：COLUMNS 小于它时进度条只留百分比，括号里去掉 "resets in"；设成 9999 就永远不显示进度条
export HUD_NARROW_COLS=150

# sort -V 做版本号排序，避免 awk 嵌套单引号在 Git Bash 下出错（上游 issue #326）
plugin_dir=$(ls -1d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | sort -V | tail -1)

extra=$("$RUN" "$hud/sys-usage-line.mjs" </dev/null)
if [ "$COLUMNS" -lt "$HUD_NARROW_COLS" ]; then
  # 窄终端：HUD 不画进度条时会给 5 小时窗口补一个 "5h" 标签（"Usage 5h 16%"），用 sed 去掉；
  # 正则容忍标签两侧的 ANSI 转义和 Usage 后的对齐空格（Context/Usage 分两行时插件会补齐标签宽度）。HUD 语言不是英文（label 不是 Usage）时此规则不生效
  "$RUN" "${plugin_dir}${ENTRY}" | sed -E $'s/(Usage *(\e\\[[0-9;]*m)*) (\e\\[[0-9;]*m)*5h(\e\\[[0-9;]*m)* /\\1 /'
else
  "$RUN" "${plugin_dir}${ENTRY}"
fi
printf '%s\n' "$extra"
