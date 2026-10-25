#!/usr/bin/env node
// hud-collector.mjs
//
// claude-hud 的共享数据采集进程：整台机器只跑一个（文件锁 shared/collector.lock），
// 由 hud-render.mjs 在发现它没在跑时拉起，所有 Claude Code 会话的 HUD 都读它写的
// shared/state.json，自己不再起任何子进程。
//
// 背景：Windows 11 26H2 每创建一个进程就泄漏一个内核 Token 对象（直到重启），8 个会话
// 每 15 秒各起二十来个进程时一天漏 2～3 GB 分页池。见 memory kernel-paged-pool-leak-2026-10。
//
// 每 5 秒一拍：
//   sys    CPU%（os.cpus() 差值）、RAM、CPU 温度（LibreHardwareMonitor HTTP，没有则每分钟一次
//          typeperf 后台采样 —— 这是本进程唯一定期起的子进程）
//   usage  每分钟调一次 fable-usage-feeder 的 runFeeder()（它自己按 5 分钟节流，纯 HTTPS）
//   账号   ~/.claude.json 比 account-label.stamp 新时更新 account-label.json
//   git    对 shared/wanted/ 里登记的每个目录（渲染端每次刷新登记一次 cwd）找到仓库根，
//          分支名/远端地址只读 .git 文件；脏状态要跑 git status，但只在 fs.watch 监听到
//          工作区有改动、或距上次超过 5 分钟时才跑，同一仓库至少隔 10 秒。
//
// 10 分钟没有任何会话登记就自动退出。日志在 shared/collector.log。
//
//   手动前台运行:  node hud-collector.mjs --foreground   （Ctrl+C 退出，日志同时打到 stderr）

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import {
  SHARED_DIR, STATE_PATH, LOCK_PATH, WANTED_DIR, COLLECTOR_LOG, CONFIG_PATH, WANT_TTL_MS, STATE_FRESH_MS,
  readJson, writeJsonAtomic, isPidAlive, findRepo, readBranch, readBranchUrl, normalizeCwd, cwdKey, mtimeMs,
} from './hud-shared.mjs';
import { cpuTicks, fetchCpuTemp, systemLang, swapUsage } from './sys-usage-line.mjs';
import { runFeeder } from './fable-usage-feeder.mjs';
import { updateAccountLabel, accountLabelStale } from './account-label.mjs';

const TICK_MS = 5_000;
const TEMP_MS = 60_000;          // 温度采样间隔（typeperf 回退路径每次要起 cmd+typeperf）
const USAGE_MS = 60_000;         // 调 runFeeder / 查账号文件的间隔
const GIT_MIN_GAP_MS = 10_000;   // 同一仓库两次 git status 的最小间隔
const GIT_FORCE_MS = 5 * 60_000; // 即使没监听到改动也最多这么久查一次
const GIT_NOWATCH_MS = 60_000;   // fs.watch 失败的仓库退化为每分钟查一次
const GIT_TIMEOUT_MS = 8_000;
const GIT_MAX_PER_TICK = 3;      // 一拍最多跑几个仓库，避免一次刷新堆起一串 git
const IDLE_EXIT_MS = 10 * 60_000;
const LOG_MAX_BYTES = 64 * 1024;

const foreground = process.argv.includes('--foreground');

function log(msg) {
  const line = `${new Date().toISOString()} [${process.pid}] ${msg}`;
  if (foreground) process.stderr.write(`${line}\n`);
  try {
    fs.mkdirSync(SHARED_DIR, { recursive: true });
    if (fs.existsSync(COLLECTOR_LOG) && fs.statSync(COLLECTOR_LOG).size > LOG_MAX_BYTES) fs.rmSync(COLLECTOR_LOG, { force: true });
    fs.appendFileSync(COLLECTOR_LOG, `${line}\n`);
  } catch { /* never fail because of logging */ }
}

// ---- 单例锁：内容是 pid，mtime 每拍刷新一次当心跳 ----
function readLockPid() {
  const n = Number.parseInt(String(readJson(LOCK_PATH)?.pid ?? ''), 10);
  return Number.isInteger(n) ? n : null;
}
function writeLock() {
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, execPath: process.execPath, startedAt: new Date().toISOString() }));
}
function acquireLock() {
  fs.mkdirSync(SHARED_DIR, { recursive: true });
  const pid = readLockPid();
  if (pid && pid !== process.pid && isPidAlive(pid)) {
    if (Date.now() - mtimeMs(LOCK_PATH) < STATE_FRESH_MS) return false;   // 另一个采集进程活着且在心跳
    // 活着但很久没心跳：当它卡死了，接管
    try { process.kill(pid); log(`killed hung collector ${pid}`); } catch { /* ignore */ }
  }
  writeLock();
  return true;
}
function heartbeat() {
  try {
    const now = new Date();
    fs.utimesSync(LOCK_PATH, now, now);
  } catch {
    try { writeLock(); } catch { /* ignore */ }
  }
}

// ---- git ----
function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
function resolveGit() {
  const exe = process.platform === 'win32' ? 'git.exe' : 'git';
  const pathValue = Object.entries(process.env).find(([k]) => k.toLowerCase() === 'path')?.[1] ?? '';
  const candidates = [];
  for (const raw of pathValue.split(path.delimiter)) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!dir || !path.isAbsolute(dir)) continue;
    candidates.push(path.join(dir, exe));
  }
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Git\\mingw64\\bin\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe');
  }
  for (const c of candidates) {
    if (!isFile(c)) continue;
    // Git for Windows 的 cmd\git.exe 只是个启动器，会再起一个真正的 git：优先用 mingw64\bin 下的本体
    const m = c.match(/^(.*)[\\/]cmd[\\/]git\.exe$/i);
    if (m) {
      const alt = path.join(m[1], 'mingw64', 'bin', 'git.exe');
      if (isFile(alt)) return alt;
    }
    return c;
  }
  return null;
}
const GIT = resolveGit();

function runGit(cwd, args, timeout = GIT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!GIT) { resolve({ ok: false, stdout: '', error: 'git not found' }); return; }
    let child;
    try {
      child = spawn(GIT, args, {
        cwd,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
        windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (e) {
      resolve({ ok: false, stdout: '', error: e.message });
      return;
    }
    const chunks = [];
    let bytes = 0;
    let failure = null;
    const timer = setTimeout(() => { failure = 'timeout'; try { child.kill(); } catch { /* ignore */ } }, timeout);
    child.stdout.on('data', (c) => {
      bytes += c.length;
      if (bytes > 1024 * 1024) { failure = 'output too large'; try { child.kill(); } catch { /* ignore */ } return; }
      chunks.push(c);
    });
    child.once('error', (e) => { failure ??= e.message; });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failure) resolve({ ok: false, stdout: '', error: failure });
      else if (code !== 0) resolve({ ok: false, stdout: '', error: `exit ${code}` });
      else resolve({ ok: true, stdout: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

// 与插件 git.js 的 untrustedConfigOverrides 同义（0.11.1 的安全修复 GHSA-fq7j-8hxj-jfqh）：
// 仓库自己的 .git/config 里的 core.fsmonitor 和 filter 驱动会在 git status / diff 时以当前用户身份
// 执行任意命令，这里一律关掉（global / system 范围的 filter 如 git-lfs 不动）。
// 结果按 .git/config 的 mtime 缓存，不用每次 refresh 都多起一个 git。
const SAFE_GIT = ['-c', 'core.quotePath=false', '--no-optional-locks'];
async function untrustedConfigOverrides(repo) {
  const cfgPath = path.join(repo.gitDir, 'config');
  let mtime = 0;
  try { mtime = fs.statSync(cfgPath).mtimeMs; } catch { /* no config */ }
  if (repo._safeArgs && repo._safeArgsMtime === mtime) return repo._safeArgs;
  const overrides = ['-c', 'core.fsmonitor=false'];
  const listed = await runGit(repo.root, ['config', '--show-scope', '-z', '--get-regexp', '^filter\\.']);
  if (listed.ok) {
    const drivers = new Set();
    const fields = listed.stdout.split('\0');
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const scope = fields[i], entry = fields[i + 1];
      if (scope === 'global' || scope === 'system') continue;
      const key = entry.split('\n', 1)[0];
      const name = key.slice('filter.'.length, key.lastIndexOf('.'));
      if (name) drivers.add(name);
    }
    for (const name of drivers) {
      overrides.push('-c', `filter.${name}.clean=`, '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`);
    }
  }
  repo._safeArgs = [...SAFE_GIT, ...overrides];
  repo._safeArgsMtime = mtime;
  return repo._safeArgs;
}

// 与插件 git.js 的 parseFileStats 同形
function parsePorcelainPath(field) {
  if (field.startsWith('"') && field.endsWith('"')) {
    try { return JSON.parse(field); } catch { return field.slice(1, -1); }
  }
  return field;
}
function parseFileStats(porcelain) {
  const stats = { modified: 0, added: 0, deleted: 0, untracked: 0, trackedFiles: [] };
  for (const line of porcelain.split('\n').filter(Boolean)) {
    if (line.length < 2) continue;
    const index = line[0], worktree = line[1];
    const push = (fullPath, type) => stats.trackedFiles.push({ basename: fullPath.split('/').pop() ?? fullPath, fullPath, type });
    if (line.startsWith('??')) stats.untracked++;
    else if (index === 'A') { stats.added++; push(parsePorcelainPath(line.slice(2).trimStart()), 'added'); }
    else if (index === 'D' || worktree === 'D') { stats.deleted++; push(parsePorcelainPath(line.slice(2).trimStart()), 'deleted'); }
    else if (index === 'M' || worktree === 'M' || index === 'R' || index === 'C') {
      stats.modified++;
      push(parsePorcelainPath(line.slice(2).trimStart().split(' -> ').pop() ?? line.slice(2).trimStart()), 'modified');
    }
  }
  return stats;
}
// 与插件 parseNumstat 的 totalDiff 同形：{ added, deleted }
function parseNumstat(out) {
  let added = 0, deleted = 0;
  for (const line of out.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
    if (!m) continue;
    if (m[1] !== '-') added += Number.parseInt(m[1], 10);
    if (m[2] !== '-') deleted += Number.parseInt(m[2], 10);
  }
  return { added, deleted };
}

// 一个被跟踪的仓库：fs.watch 监听工作区，有改动时标记 changed
class RepoTrack {
  constructor(repo) {
    this.repo = repo;
    this.changed = true;
    this.lastRun = 0;
    this.lastSeen = Date.now();
    this.result = null;
    this.watchers = [];
    this.watchOk = false;
    this.startWatch();
  }
  startWatch() {
    const onError = (e) => { log(`watch error ${this.repo.root}: ${e.message}`); this.stopWatch(); };
    try {
      const w = fs.watch(this.repo.root, { recursive: true, persistent: false }, (ev, fn) => this.onEvent(fn));
      w.on('error', onError);
      this.watchers.push(w);
      // worktree 的 .git 目录在仓库外面，HEAD/index 的变化另外监听
      const insideRoot = normalizeCwd(this.repo.gitDir).startsWith(normalizeCwd(this.repo.root) + path.sep);
      if (!insideRoot) {
        const w2 = fs.watch(this.repo.gitDir, { recursive: false, persistent: false }, () => { this.changed = true; });
        w2.on('error', onError);
        this.watchers.push(w2);
      }
      this.watchOk = true;
    } catch (e) {
      log(`watch failed ${this.repo.root}: ${e.message}`);
      this.stopWatch();
    }
  }
  stopWatch() {
    for (const w of this.watchers) { try { w.close(); } catch { /* ignore */ } }
    this.watchers = [];
    this.watchOk = false;
  }
  onEvent(filename) {
    if (!filename) { this.changed = true; return; }
    const rel = String(filename).replace(/\\/g, '/');
    if (rel === '.git' || rel.startsWith('.git/')) {
      // .git 里只有这些文件的变化会影响分支名或脏状态；objects/ 等的写入不用管
      if (/^\.git\/(HEAD|ORIG_HEAD|MERGE_HEAD|index|packed-refs|refs\/)/.test(rel)) this.changed = true;
      return;
    }
    this.changed = true;
  }
  due(now) {
    if (!this.result) return true;
    if (this.changed && now - this.lastRun >= GIT_MIN_GAP_MS) return true;
    return now - this.lastRun >= (this.watchOk ? GIT_FORCE_MS : GIT_NOWATCH_MS);
  }
  async refresh(cfg) {
    const now = Date.now();
    this.changed = false;
    this.lastRun = now;
    const repo = this.repo;
    const branch = readBranch(repo);
    if (!branch) { this.result = null; return; }
    const prev = this.result;
    const result = {
      branch, isDirty: prev?.isDirty ?? false, ahead: 0, behind: 0,
      fileStats: prev?.fileStats, lineDiff: prev?.lineDiff, branchUrl: readBranchUrl(repo, branch), ts: now,
    };
    const safe = await untrustedConfigOverrides(repo);
    const status = await runGit(repo.root, [...safe, 'status', '--porcelain', '--ignore-submodules=dirty']);
    if (status.ok) {
      const trimmed = status.stdout.trim();
      result.isDirty = trimmed.length > 0;
      result.fileStats = result.isDirty ? parseFileStats(trimmed) : undefined;
      result.lineDiff = undefined;
      if (result.isDirty && cfg.showFileStats) {
        // diff-index 而不是 diff：diff 会刷新 .git/index，超时被杀时留下 index.lock（上游 0.11.0 #807）
        const num = await runGit(repo.root, [...safe, 'diff-index', '-M', '--numstat', '--ignore-submodules=dirty', 'HEAD']);
        if (num.ok) result.lineDiff = parseNumstat(num.stdout);
      }
    } else {
      log(`git status failed ${repo.root}: ${status.error}`);
    }
    if (cfg.showAheadBehind) {
      const rev = await runGit(repo.root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
      const parts = rev.ok ? rev.stdout.trim().split(/\s+/) : [];
      if (parts.length === 2) {
        result.behind = Number.parseInt(parts[0], 10) || 0;
        result.ahead = Number.parseInt(parts[1], 10) || 0;
      }
    }
    this.result = result;
  }
}

// ---- 登记的目录 ----
function scanWanted(now) {
  const list = [];
  let names = [];
  try { names = fs.readdirSync(WANTED_DIR); } catch { return list; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const p = path.join(WANTED_DIR, name);
    const entry = readJson(p);
    const ts = typeof entry?.ts === 'number' ? entry.ts : mtimeMs(p);
    if (!entry?.cwd || now - ts > WANT_TTL_MS) {
      try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
      continue;
    }
    list.push({ cwd: entry.cwd, key: name.slice(0, -5), ts });
  }
  return list;
}

// ---- 主循环 ----
const repos = new Map();          // normalized root -> RepoTrack
const rootCache = new Map();      // normalized cwd -> { repo|null, ts }
let prevTicks = cpuTicks();
let cpu = null;
let temp = null;
let swap = null;
let lastTemp = 0;
let lastUsage = 0;
let lastWanted = Date.now();
let lang = 'zh';
let stopping = false;

function repoFor(cwd, now) {
  const key = normalizeCwd(cwd);
  const cached = rootCache.get(key);
  if (cached && now - cached.ts < 60_000) return cached.repo;
  let repo = null;
  try { repo = findRepo(cwd); } catch { repo = null; }
  rootCache.set(key, { repo, ts: now });
  return repo;
}

async function tick() {
  const now = Date.now();
  if (readLockPid() !== process.pid) { log('lock taken over by another collector, exiting'); await shutdown(0); return; }
  heartbeat();

  // 1. 系统采样
  const cur = cpuTicks();
  const dTotal = cur.total - prevTicks.total, dIdle = cur.idle - prevTicks.idle;
  if (dTotal > 0 && dIdle >= 0) cpu = Math.round(Math.min(100, Math.max(0, (1 - dIdle / dTotal) * 100)));
  prevTicks = cur;
  if (now - lastTemp >= TEMP_MS) {
    lastTemp = now;
    try { temp = await fetchCpuTemp(); } catch { temp = null; }
    try { swap = swapUsage(); } catch { swap = null; }
  }

  // 2. 用量快照 / 账号标签
  if (now - lastUsage >= USAGE_MS) {
    lastUsage = now;
    runFeeder().then((r) => { if (r === 'fail') log('usage feeder failed (see usage-feeder.log)'); }).catch((e) => log(`feeder error ${e.message}`));
    try { if (accountLabelStale()) updateAccountLabel(); } catch { /* ignore */ }
  }

  // 3. git
  const wanted = scanWanted(now);
  if (wanted.length) lastWanted = now;
  else if (now - lastWanted > IDLE_EXIT_MS) { log('no sessions for 10 minutes, exiting'); await shutdown(0); return; }

  const gitCfg = readJson(CONFIG_PATH)?.gitStatus ?? {};
  const gitEnabled = gitCfg.enabled !== false;
  const git = {};
  const inUse = new Set();
  if (gitEnabled) {
    let ran = 0;
    for (const w of wanted) {
      const repo = repoFor(w.cwd, now);
      if (!repo) { git[w.key] = { cwd: w.cwd, root: null, status: null }; continue; }
      const rootKey = normalizeCwd(repo.root);
      inUse.add(rootKey);
      let track = repos.get(rootKey);
      if (!track) { track = new RepoTrack(repo); repos.set(rootKey, track); log(`tracking ${repo.root}`); }
      track.lastSeen = now;
      if (ran < GIT_MAX_PER_TICK && track.due(now)) {
        ran++;
        try { await track.refresh(gitCfg); } catch (e) { log(`refresh error ${repo.root}: ${e.message}`); }
      }
      git[w.key] = { cwd: w.cwd, root: repo.root, status: track.result };
    }
  }
  for (const [rootKey, track] of repos) {
    if (!inUse.has(rootKey) && now - track.lastSeen > WANT_TTL_MS) {
      track.stopWatch();
      repos.delete(rootKey);
      log(`dropped ${track.repo.root}`);
    }
  }

  // 4. 落盘
  const total = os.totalmem();
  const free = Math.min(Math.max(os.freemem(), 0), total);
  const state = {
    ts: Date.now(), pid: process.pid, lang,
    sys: { cpu, temp, swap, mem: { used: total - free, total } },
    git, sessions: wanted.length, repos: repos.size,
  };
  writeJsonAtomic(STATE_PATH, state);
}

let timer = null;
async function loop() {
  if (stopping) return;
  try { await tick(); } catch (e) { log(`tick error: ${e.stack ?? e.message}`); }
  if (!stopping) timer = setTimeout(loop, TICK_MS);
}

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  for (const track of repos.values()) track.stopWatch();
  try { if (readLockPid() === process.pid) fs.rmSync(LOCK_PATH, { force: true }); } catch { /* ignore */ }
  log(`exit ${code}`);
  process.exit(code);
}

function main() {
  fs.mkdirSync(WANTED_DIR, { recursive: true });
  if (!acquireLock()) {
    if (foreground) process.stderr.write('another collector is running\n');
    process.exit(0);
  }
  try { lang = systemLang(); } catch { lang = 'zh'; }
  log(`start node=${process.version} git=${GIT ?? 'none'} lang=${lang}`);
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (e) => { log(`uncaught: ${e.stack ?? e.message}`); });
  process.on('unhandledRejection', (e) => { log(`unhandled: ${e?.stack ?? e}`); });
  // 定时器之外没有东西撑着事件循环（watcher 都是 persistent:false），用一个空 interval 保活
  setInterval(() => {}, 1 << 30);
  loop();
}

main();
