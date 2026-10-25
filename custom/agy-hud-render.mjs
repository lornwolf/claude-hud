#!/usr/bin/env node
// agy-hud-render.mjs
//
// Antigravity CLI (agy) 专用的 statusLine 唯一入口：
// 与 Claude Code 的 hud-render.mjs 共享同一个常驻采集进程（hud-collector.mjs）、
// 共享同一套配置文件（config.json / account-label.json）以及底部两行（中日双语日期 + CPU/温度/RAM/Swap）。
//
// 启用方式（二选一）：
//   1. 在 agy 交互界面输入（注意不要加双引号）：
//      /statusline node C:/Users/songzongzheng/.claude/plugins/claude-hud/agy-hud-render.mjs
//   2. 或在 ~/.gemini/antigravity-cli/settings.json 中写入：
//      "statusLine": {
//        "type": "command",
//        "command": "node C:/Users/songzongzheng/.claude/plugins/claude-hud/agy-hud-render.mjs"
//      }
//
// 相比 hud-render.mjs 的适配点：
//   1. 终端宽度优先取 agy stdin JSON 中的 terminal_width，再回退到环境变量 COLUMNS
//   2. 将 agy stdin.quota（各配额桶的 remaining_fraction 与 reset_time）映射为 claude-hud 的 UsageData
//   3. 屏蔽 Claude 专用的 externalUsagePath（避免把 Claude 的 Fable Weekly 快照混入 agy）
//   4. 采集进程缓存未命中时，用 agy stdin.vcs (branch/dirty) 结合 liteGitStatus (branchUrl) 兜底
//   5. 轻量解析 agy 的 transcript.jsonl（提取会话开始时间、conversation_title 与子 Agent 状态）

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  HERE, LOCK_PATH, SPAWN_STAMP_PATH, WANTED_DIR, STATE_FRESH_MS,
  claudeConfigDir, readState, isStateFresh, isPidAlive, readJson, cwdKey, liteGitStatus, mtimeMs,
} from './hud-shared.mjs';
import { applyWidthToConfig, buildExtraLines, cpuPercent } from './sys-usage-line.mjs';

const COLLECTOR = path.join(HERE, 'hud-collector.mjs');
const ACCOUNT_LABEL_PATH = path.join(HERE, 'account-label.json');
const GIT_RESULT_FRESH_MS = 10 * 60_000;
const WANT_REWRITE_MS = 30_000;
const SPAWN_GAP_MS = 10_000;
const NARROW_5H_RE = /(Usage *(\x1b\[[0-9;]*m)*) (\x1b\[[0-9;]*m)*5h(\x1b\[[0-9;]*m)* /;

function hudDisabled(env = process.env) {
  const v = env.CLAUDE_HUD_DISABLE?.trim().toLowerCase();
  if (v === undefined || v === '') return false;
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

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

function ensureCollector() {
  try {
    if (Date.now() - mtimeMs(LOCK_PATH) < STATE_FRESH_MS) return;
    const pid = Number.parseInt(String(readJson(LOCK_PATH)?.pid ?? ''), 10);
    if (Number.isInteger(pid) && isPidAlive(pid) && Date.now() - mtimeMs(LOCK_PATH) < 3 * STATE_FRESH_MS) return;
    if (Date.now() - mtimeMs(SPAWN_STAMP_PATH) < SPAWN_GAP_MS) return;
    fs.mkdirSync(path.dirname(SPAWN_STAMP_PATH), { recursive: true });
    fs.writeFileSync(SPAWN_STAMP_PATH, String(Date.now()));
    const child = spawn(process.execPath, [COLLECTOR], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch {
    // 采集进程拉起失败时静默回退到本进程兜底
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
  if (!entry) return undefined;
  if (!entry.root) return null;
  const s = entry.status;
  if (!s || Date.now() - (s.ts ?? 0) > GIT_RESULT_FRESH_MS) return undefined;
  return { branch: s.branch, isDirty: s.isDirty, ahead: s.ahead, behind: s.behind, fileStats: s.fileStats, lineDiff: s.lineDiff, branchUrl: s.branchUrl };
}

// 格式化配额桶名称（如 "claude-sonnet-weekly" -> "Claude Sonnet Weekly"）
function formatBucketLabel(bucketId) {
  return String(bucketId)
    .trim()
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// 将 agy 的 stdin.quota 转换为 claude-hud 的 UsageData
function convertAgyQuota(stdin, origGetUsageFromStdin) {
  if (stdin?.rate_limits && typeof origGetUsageFromStdin === 'function') {
    const nativeUsage = origGetUsageFromStdin(stdin);
    if (nativeUsage) return nativeUsage;
  }
  const quota = stdin?.quota;
  if (!quota || typeof quota !== 'object' || Array.isArray(quota)) {
    return null;
  }
  const entries = Object.entries(quota);
  if (!entries.length) return null;

  let fiveHour = null;
  let fiveHourResetAt = null;
  let sevenDay = null;
  let sevenDayResetAt = null;
  const scopedWindows = [];

  for (const [bucketId, raw] of entries) {
    if (!raw || typeof raw !== 'object') continue;
    let usedPct = null;
    if (typeof raw.remaining_fraction === 'number' && Number.isFinite(raw.remaining_fraction)) {
      usedPct = Math.round(Math.min(100, Math.max(0, (1 - raw.remaining_fraction) * 100)));
    } else if (typeof raw.used_percentage === 'number' && Number.isFinite(raw.used_percentage)) {
      usedPct = Math.round(Math.min(100, Math.max(0, raw.used_percentage)));
    }
    if (usedPct === null) continue;

    let resetAt = null;
    if (typeof raw.reset_time === 'string' && !Number.isNaN(Date.parse(raw.reset_time))) {
      resetAt = new Date(raw.reset_time);
    } else if (typeof raw.reset_in_seconds === 'number' && Number.isFinite(raw.reset_in_seconds) && raw.reset_in_seconds > 0) {
      resetAt = new Date(Date.now() + raw.reset_in_seconds * 1000);
    }

    const key = bucketId.trim().toLowerCase();
    if (fiveHour === null && (/^(?:5h|five[_-]?hour|hourly|daily)$/.test(key) || /(?:[_-](?:5h|hourly))$/.test(key))) {
      fiveHour = usedPct;
      fiveHourResetAt = resetAt;
    } else if (sevenDay === null && /^(?:7d|seven[_-]?day|weekly|gemini[_-]?weekly)$/.test(key)) {
      sevenDay = usedPct;
      sevenDayResetAt = resetAt;
    } else {
      scopedWindows.push({
        label: formatBucketLabel(bucketId),
        percent: usedPct,
        resetAt,
      });
    }
  }

  if (fiveHour === null && sevenDay === null && !scopedWindows.length) {
    return null;
  }
  return {
    fiveHour,
    sevenDay,
    fiveHourResetAt,
    sevenDayResetAt,
    ...(scopedWindows.length ? { scopedWindows } : {}),
  };
}

// 轻量解析 agy 的 transcript.jsonl：只读文件头尾，提取 sessionStart、conversation_title 与子 Agent
function parseAgyTranscript(transcriptPath, stdin) {
  const result = {
    tools: [],
    agents: [],
    todos: [],
    sessionStart: undefined,
    sessionName: stdin?.conversation_title?.trim() || undefined,
  };
  if (!transcriptPath) return result;

  let fd;
  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile() || stat.size === 0) return result;
    fd = fs.openSync(transcriptPath, 'r');

    // 读头部 4KB 获取第一行的 created_at 作为会话起始时间
    const headLen = Math.min(stat.size, 4096);
    const headBuf = Buffer.alloc(headLen);
    fs.readSync(fd, headBuf, 0, headLen, 0);
    const firstNewline = headBuf.indexOf(0x0a);
    const firstLine = headBuf.subarray(0, firstNewline >= 0 ? firstNewline : headLen).toString('utf8').trim();
    if (firstLine.startsWith('{')) {
      try {
        const firstObj = JSON.parse(firstLine);
        if (firstObj?.created_at && !Number.isNaN(Date.parse(firstObj.created_at))) {
          result.sessionStart = new Date(firstObj.created_at);
        }
      } catch { /* 第一行超长被截断时忽略 */ }
    }

    // 读尾部 64KB 提取最近的 invoke_subagent 调用
    const tailLen = Math.min(stat.size, 65536);
    const tailOffset = stat.size - tailLen;
    const tailBuf = Buffer.alloc(tailLen);
    fs.readSync(fd, tailBuf, 0, tailLen, tailOffset);
    const tailText = tailBuf.toString('utf8');
    const lines = tailText.split(/\r?\n/);
    if (tailOffset > 0 && lines.length > 1) {
      lines.shift(); // 丢弃可能被截断的首行
    }

    const agents = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{') || !trimmed.includes('invoke_subagent')) continue;
      try {
        const step = JSON.parse(trimmed);
        if (!Array.isArray(step?.tool_calls)) continue;
        const stepTime = step.created_at && !Number.isNaN(Date.parse(step.created_at))
          ? new Date(step.created_at)
          : new Date();
        for (const tc of step.tool_calls) {
          if (tc?.name !== 'invoke_subagent') continue;
          let rawSubagents = tc.args?.Subagents;
          if (typeof rawSubagents === 'string') {
            try { rawSubagents = JSON.parse(rawSubagents); } catch { /* ignore */ }
          }
          if (!Array.isArray(rawSubagents)) continue;
          for (let i = 0; i < rawSubagents.length; i++) {
            const sub = rawSubagents[i];
            const typeName = typeof sub?.TypeName === 'string' ? sub.TypeName.replace(/^"|"$/g, '') : 'subagent';
            const role = typeof sub?.Role === 'string' ? sub.Role.replace(/^"|"$/g, '') : '';
            agents.push({
              id: `step-${step.step_index ?? 0}-${i}`,
              type: typeName,
              description: role || undefined,
              status: step.status === 'RUNNING' ? 'running' : 'completed',
              startTime: stepTime,
              endTime: step.status === 'RUNNING' ? undefined : stepTime,
            });
          }
        }
      } catch { /* ignore malformed line */ }
    }
    if (agents.length) {
      result.agents = agents.slice(-10);
    }
  } catch {
    // 忽略读取异常
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
  return result;
}

function applyAgyAccountLabel(config, stdin, narrow) {
  const email = stdin?.email?.trim();
  if (!email) return;
  const acct = readJson(ACCOUNT_LABEL_PATH);
  const name = acct?.displayName?.trim() || '';
  if (narrow) {
    config.display.customLine = name || email;
    return;
  }
  config.display.customLine = [name, email].filter(Boolean).join(' · ');
}

async function main() {
  if (hudDisabled()) return;

  const state = readState();
  ensureCollector();

  const pluginDir = findPluginDir();
  const lines = [];
  const capture = (...args) => lines.push(args.map(String).join(' '));
  let narrow = false;

  if (!pluginDir) {
    capture('[claude-hud] plugin not found under plugins/cache');
  } else {
    const dist = (f) => pathToFileURL(path.join(pluginDir, 'dist', f)).href;
    const [
      { main: hudMain },
      { loadConfig },
      { readStdin, getUsageFromStdin: origGetUsageFromStdin },
    ] = await Promise.all([
      import(dist('index.js')),
      import(dist('config.js')),
      import(dist('stdin.js')),
    ]);

    // 先读取 agy 的 stdin JSON，以便拿到 terminal_width 后再设定 COLUMNS 与 narrow
    const rawStdin = await readStdin();
    if (rawStdin && !rawStdin.cwd && rawStdin.workspace?.current_dir) {
      rawStdin.cwd = rawStdin.workspace.current_dir;
    }
    if (rawStdin?.cwd) {
      registerWant(rawStdin.cwd);
    }

    const stdinCols = Number.parseInt(String(rawStdin?.terminal_width ?? ''), 10);
    const envCols = Number.parseInt(process.env.COLUMNS ?? '', 10);
    const cols = Number.isFinite(stdinCols) && stdinCols > 0
      ? stdinCols
      : (Number.isFinite(envCols) && envCols > 0 ? envCols : 120);
    const usable = cols > 4 ? cols - 4 : 1;
    process.env.COLUMNS = String(usable);
    const narrowLimit = Number.parseInt(process.env.HUD_NARROW_COLS ?? '', 10);
    narrow = usable < (Number.isFinite(narrowLimit) && narrowLimit > 0 ? narrowLimit : 150);
    process.env.HUD_NARROW_COLS ??= '150';

    const origLog = console.log;
    console.log = capture;
    try {
      await hudMain({
        readStdin: async () => rawStdin,
        loadConfig: async () => {
          const config = await loadConfig();
          applyWidthToConfig(config, narrow);
          applyAgyAccountLabel(config, rawStdin, narrow);
          // 屏蔽 Claude Code 专用的 Fable 外部快照，只展示 agy 自身的配额
          config.display.externalUsagePath = undefined;
          config.display.externalUsageWritePath = undefined;
          return config;
        },
        getGitStatus: async (cwd) => {
          const cached = cachedGitStatus(state, cwd);
          if (cached !== undefined) return cached;
          const lite = liteGitStatus(cwd);
          const vcsBranch = rawStdin?.vcs?.branch?.trim();
          if (vcsBranch) {
            return {
              branch: vcsBranch,
              isDirty: Boolean(rawStdin?.vcs?.dirty),
              ahead: 0,
              behind: 0,
              branchUrl: lite?.branchUrl,
            };
          }
          return lite;
        },
        getUsageFromStdin: (stdin) => convertAgyQuota(stdin, origGetUsageFromStdin),
        parseTranscript: async (transcriptPath) => parseAgyTranscript(transcriptPath, rawStdin),
        log: capture,
      });
    } finally {
      console.log = origLog;
    }
  }

  const body = narrow ? lines.map((l) => l.replace(NARROW_5H_RE, '$1 ')) : lines;

  let extra;
  if (isStateFresh(state) && state.sys) {
    extra = buildExtraLines({ cpu: state.sys.cpu ?? null, temp: state.sys.temp ?? null, swap: state.sys.swap ?? null, narrow, lang: state.lang });
  } else {
    extra = buildExtraLines({ cpu: cpuPercent(), temp: null, swap: null, narrow, lang: state?.lang ?? 'zh' });
  }
  process.stdout.write(`${body.join('\n')}${body.length ? '\n' : ''}${extra}`);
}

main().catch((e) => {
  process.stdout.write(`[claude-hud] agy-hud-render error: ${e?.message ?? e}\n`);
});
