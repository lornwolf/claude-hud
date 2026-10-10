// hud-shared.mjs
//
// hud-render.mjs（每次刷新跑一次）和 hud-collector.mjs（常驻采集进程）共用的小工具：
// 共享目录的路径、state.json 的读写、cwd 的键、只靠读文件就能拿到的 git 信息。
// 这里的函数一律不启动子进程。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SHARED_DIR = path.join(HERE, 'shared');
export const STATE_PATH = path.join(SHARED_DIR, 'state.json');
export const LOCK_PATH = path.join(SHARED_DIR, 'collector.lock');
export const SPAWN_STAMP_PATH = path.join(SHARED_DIR, 'collector.spawn');
export const WANTED_DIR = path.join(SHARED_DIR, 'wanted');
export const COLLECTOR_LOG = path.join(SHARED_DIR, 'collector.log');
export const CONFIG_PATH = path.join(HERE, 'config.json');
export const ACCOUNT_PATH = path.join(HERE, 'account-label.json');

// state.json 多久算过期：渲染端超过这个时间就当采集进程挂了
export const STATE_FRESH_MS = 90_000;
// wanted/ 里的登记多久算失效（会话关掉后采集进程停止跟踪它的目录）
export const WANT_TTL_MS = 3 * 60_000;

export function claudeConfigDir() {
  const env = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (env) return path.resolve(env.replace(/^~(?=$|[\\/])/, os.homedir()));
  return path.join(os.homedir(), '.claude');
}

export function isDirectEntrypoint(metaUrl) {
  if (!process.argv[1]) return false;
  const a = path.resolve(fileURLToPath(metaUrl));
  const b = path.resolve(process.argv[1]);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function mtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

export function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// 原子写：先写 tmp 再 rename。Windows 上别的进程正在读目标文件时 rename 会 EPERM，
// 重试几次，仍失败就把 tmp 删掉，不留垃圾文件。
export function writeJsonAtomic(p, value, tries = 4) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  for (let i = 0; i < tries; i++) {
    try {
      fs.renameSync(tmp, p);
      return true;
    } catch {
      const until = Date.now() + 15;
      while (Date.now() < until) { /* 短暂等待后重试 */ }
    }
  }
  try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  return false;
}

export function readState() {
  return readJson(STATE_PATH);
}

export function isStateFresh(state, maxAgeMs = STATE_FRESH_MS) {
  return Boolean(state && typeof state.ts === 'number' && Date.now() - state.ts < maxAgeMs);
}

export function normalizeCwd(cwd) {
  let p = path.resolve(String(cwd ?? ''));
  if (process.platform === 'win32') p = p.replace(/\//g, '\\').toLowerCase();
  return p;
}

export function cwdKey(cwd) {
  return crypto.createHash('sha1').update(normalizeCwd(cwd)).digest('hex').slice(0, 16);
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

// ---- 只读文件的 git 信息（不起进程） ----

// 从 cwd 向上找 .git（目录或 worktree 的 .git 文件）。返回 { root, gitDir, commonDir } 或 null。
export function findRepo(cwd) {
  let dir = path.resolve(cwd);
  for (let i = 0; i < 64; i++) {
    const dotGit = path.join(dir, '.git');
    let st = null;
    try { st = fs.statSync(dotGit); } catch { /* not here */ }
    if (st) {
      let gitDir = dotGit;
      if (st.isFile()) {
        const m = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
        if (!m) return null;
        gitDir = path.resolve(dir, m[1].trim());
      }
      let commonDir = gitDir;
      try {
        const c = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim();
        if (c) commonDir = path.resolve(gitDir, c);
      } catch { /* 普通仓库没有 commondir */ }
      return { root: dir, gitDir, commonDir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// 当前分支名；detached 时先找指向同一提交的 tag，没有就 "detached:<短 sha>"（与插件 resolveGitRef 一致）
export function readBranch(repo) {
  let head;
  try {
    head = fs.readFileSync(path.join(repo.gitDir, 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
  const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
  if (ref) return ref[1];
  if (!/^[0-9a-f]{40,64}$/.test(head)) return null;
  const tag = findTagForSha(repo, head);
  return tag ?? `detached:${head.slice(0, 7)}`;
}

function findTagForSha(repo, sha) {
  try {
    const packed = fs.readFileSync(path.join(repo.commonDir, 'packed-refs'), 'utf8');
    for (const line of packed.split(/\r?\n/)) {
      const m = line.match(/^([0-9a-f]{40,64}) refs\/tags\/(.+)$/);
      if (m && m[1] === sha) return m[2];
    }
  } catch { /* no packed-refs */ }
  try {
    const tagsDir = path.join(repo.commonDir, 'refs', 'tags');
    for (const name of fs.readdirSync(tagsDir)) {
      try {
        if (fs.readFileSync(path.join(tagsDir, name), 'utf8').trim() === sha) return name;
      } catch { /* skip */ }
    }
  } catch { /* no loose tags */ }
  return null;
}

// origin 的 GitHub 网址（给插件画分支超链接用），非 GitHub 远端返回 undefined
export function readBranchUrl(repo, branch) {
  if (!branch) return undefined;
  let cfg;
  try {
    cfg = fs.readFileSync(path.join(repo.commonDir, 'config'), 'utf8');
  } catch {
    return undefined;
  }
  let section = '';
  let url = null;
  for (const raw of cfg.split(/\r?\n/)) {
    const line = raw.trim();
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { section = sec[1].trim(); continue; }
    if (section === 'remote "origin"') {
      const m = line.match(/^url\s*=\s*(.+)$/);
      if (m) { url = m[1].trim(); break; }
    }
  }
  if (!url) return undefined;
  const httpsBase = url
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/\.git$/, '');
  if (!httpsBase.startsWith('https://github.com/')) return undefined;
  const detached = branch.match(/^detached:([0-9a-f]+)$/);
  if (detached) return `${httpsBase}/commit/${detached[1]}`;
  return `${httpsBase}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`;
}

// 渲染端在采集进程还没来得及跑 git 时的兜底：只有分支名，不判脏
export function liteGitStatus(cwd) {
  try {
    const repo = findRepo(cwd);
    if (!repo) return null;
    const branch = readBranch(repo);
    if (!branch) return null;
    return { branch, isDirty: false, ahead: 0, behind: 0, branchUrl: readBranchUrl(repo, branch) };
  } catch {
    return null;
  }
}
