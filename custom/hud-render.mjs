#!/usr/bin/env node
// hud-render.mjs
//
// statusLine 命令的唯一入口：一次刷新只有这一个 node 进程，不再起 bash 子 shell、git、
// sys-usage-line、feeder 等。写进 ~/.claude/settings.json：
//
//   "statusLine": { "type": "command",
//                   "command": "\"/c/Program Files/nodejs/node.exe\" \"$HOME/.claude/plugins/claude-hud/hud-render.mjs\"",
//                   "refreshInterval": 15 }
//
// 做的事：
//   1. 读 shared/state.json（hud-collector.mjs 常驻进程每 5 秒写一次）；采集进程没在跑就拉起它
//   2. 把本会话的 cwd 登记到 shared/wanted/，采集进程据此跟踪这个仓库
//   3. 在同一个进程里 import 插件的 dist/ 各模块，经 hud-pipeline.mjs 的 runHud(pluginDir, overrides)
//      复刻插件 main() 的流程（插件 0.10.0 起 main() 不再接受 overrides）：
//        getGitStatus  → 用采集进程的结果（没有时只读 .git/HEAD 给分支名）
//        loadConfig    → 读完 config.json 后按终端宽度在内存里改开关（不再改写文件）
//        readStdin     → 顺便登记 cwd
//   4. 把插件输出截下来，窄终端时去掉多出来的 "5h" 标签，再接上日期行和 CPU/RAM 行
//
// 终端宽度来自 Claude Code 传入的 COLUMNS（≥2.1.153），减 4 是输入框两侧留白；
// HUD_NARROW_COLS（默认 150）以下算窄终端。CLAUDE_HUD_DISABLE=1 时什么都不输出。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import {
  HERE, LOCK_PATH, SPAWN_STAMP_PATH, WANTED_DIR, STATE_FRESH_MS,
  claudeConfigDir, readState, isStateFresh, isPidAlive, readJson, cwdKey, liteGitStatus, mtimeMs,
} from './hud-shared.mjs';
import { applyWidthToConfig, buildExtraLines, cpuPercent } from './sys-usage-line.mjs';
import { runHud, hudDisabled } from './hud-pipeline.mjs';

const COLLECTOR = path.join(HERE, 'hud-collector.mjs');
const GIT_RESULT_FRESH_MS = 10 * 60_000;
const WANT_REWRITE_MS = 30_000;
const SPAWN_GAP_MS = 10_000;
// 窄终端：HUD 不画进度条时会给 5 小时窗口补一个 "5h" 标签（"Usage 5h 16%"），去掉它；
// 正则容忍标签两侧的 ANSI 转义和 Usage 后的对齐空格。HUD 语言不是英文时不生效。
const NARROW_5H_RE = /(Usage *(\x1b\[[0-9;]*m)*) (\x1b\[[0-9;]*m)*5h(\x1b\[[0-9;]*m)* /;

// 版本号最高的插件缓存目录：<config>/plugins/cache/<marketplace>/claude-hud/<version>/
function findPluginDir() {
  const override = process.env.CLAUDE_HUD_PLUGIN_DIR?.trim();
  if (override && fs.existsSync(path.join(override, 'dist', 'index.js'))) return override;
  const cache = path.join(claudeConfigDir(), 'plugins', 'cache');
  const found = [];
  let markets = [];
  try { markets = fs.readdirSync(cache); } catch { return null; }
  for (const m of markets) {
    const base = path.join(cache, m, 'claude-hud');
    let versions = [];
    try { versions = fs.readdirSync(base); } catch { continue; }
    for (const v of versions) {
      const dir = path.join(base, v);
      if (fs.existsSync(path.join(dir, 'dist', 'index.js'))) found.push({ v, dir });
    }
  }
  if (!found.length) return null;
  const parts = (v) => v.split(/[.\-]/).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
  found.sort((a, b) => {
    const pa = parts(a.v), pb = parts(b.v);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] ?? 0, y = pb[i] ?? 0;
      if (x === y) continue;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x) < String(y) ? -1 : 1;
    }
    return 0;
  });
  return found[found.length - 1].dir;
}

// 采集进程活着的标志是 collector.lock 的 mtime（每拍刷新）。不新鲜就拉起一个；
// 多个会话同时发现时靠 collector.spawn 时间戳错开，多余的采集进程会因为拿不到锁自己退出。
function ensureCollector() {
  try {
    if (Date.now() - mtimeMs(LOCK_PATH) < STATE_FRESH_MS) return;
    const pid = Number.parseInt(String(readJson(LOCK_PATH)?.pid ?? ''), 10);
    if (Number.isInteger(pid) && isPidAlive(pid) && Date.now() - mtimeMs(LOCK_PATH) < 3 * STATE_FRESH_MS) return; // 刚启动或暂时卡顿，再等等
    if (Date.now() - mtimeMs(SPAWN_STAMP_PATH) < SPAWN_GAP_MS) return;
    fs.mkdirSync(path.dirname(SPAWN_STAMP_PATH), { recursive: true });
    fs.writeFileSync(SPAWN_STAMP_PATH, String(Date.now()));
    const child = spawn(process.execPath, [COLLECTOR], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch {
    // 拉不起来就退回到本进程自己算（见下面的兜底）
  }
}

function registerWant(cwd) {
  try {
    const p = path.join(WANTED_DIR, `${cwdKey(cwd)}.json`);
    if (Date.now() - mtimeMs(p) < WANT_REWRITE_MS) return;
    fs.mkdirSync(WANTED_DIR, { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ cwd, ts: Date.now() }));
  } catch { /* ignore */ }
}

function cachedGitStatus(state, cwd) {
  if (!isStateFresh(state)) return undefined;
  const entry = state.git?.[cwdKey(cwd)];
  if (!entry) return undefined;                 // 采集进程还没看到这个 cwd 的登记
  if (!entry.root) return null;                 // 不是 git 仓库
  const s = entry.status;
  if (!s || Date.now() - (s.ts ?? 0) > GIT_RESULT_FRESH_MS) return undefined;
  return { branch: s.branch, isDirty: s.isDirty, ahead: s.ahead, behind: s.behind, fileStats: s.fileStats, lineDiff: s.lineDiff, branchUrl: s.branchUrl };
}

async function main() {
  if (hudDisabled()) return;

  const colsRaw = Number.parseInt(process.env.COLUMNS ?? '', 10);
  const cols = Number.isFinite(colsRaw) && colsRaw > 0 ? colsRaw : 120;
  const usable = cols > 4 ? cols - 4 : 1;
  process.env.COLUMNS = String(usable);
  const narrowLimit = Number.parseInt(process.env.HUD_NARROW_COLS ?? '', 10);
  const narrow = usable < (Number.isFinite(narrowLimit) && narrowLimit > 0 ? narrowLimit : 150);
  process.env.HUD_NARROW_COLS ??= '150';

  const state = readState();
  ensureCollector();

  const pluginDir = findPluginDir();
  const lines = [];
  const capture = (...args) => lines.push(args.map(String).join(' '));
  if (!pluginDir) {
    capture('[claude-hud] plugin not found under plugins/cache');
  } else {
    const origLog = console.log;
    console.log = capture;
    try {
      await runHud(pluginDir, (plugin) => ({
        readStdin: async () => {
          const s = await plugin.readStdin();
          if (s?.cwd) registerWant(s.cwd);
          return s;
        },
        loadConfig: async () => {
          const config = await plugin.loadConfig();
          applyWidthToConfig(config, narrow);
          return config;
        },
        getGitStatus: async (cwd) => {
          const cached = cachedGitStatus(state, cwd);
          return cached === undefined ? liteGitStatus(cwd) : cached;
        },
        log: capture,
      }));
    } finally {
      console.log = origLog;
    }
  }

  const body = narrow ? lines.map((l) => l.replace(NARROW_5H_RE, '$1 ')) : lines;

  // 底部两行：采集进程的数据新鲜就用它，否则本进程兜底（CPU 用 cpu-sample.json 差值，温度省略）
  let extra;
  if (isStateFresh(state) && state.sys) {
    extra = buildExtraLines({ cpu: state.sys.cpu ?? null, temp: state.sys.temp ?? null, swap: state.sys.swap ?? null, narrow, lang: state.lang });
  } else {
    extra = buildExtraLines({ cpu: cpuPercent(), temp: null, swap: null, narrow, lang: state?.lang ?? 'zh' });
  }
  process.stdout.write(`${body.join('\n')}${body.length ? '\n' : ''}${extra}`);
}

main().catch((e) => {
  process.stdout.write(`[claude-hud] hud-render error: ${e?.message ?? e}\n`);
});
