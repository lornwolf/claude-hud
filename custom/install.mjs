#!/usr/bin/env node
// install.mjs —— 一条命令装好插件本体和 custom/ 定制（重复运行即为更新）：
//
//   git clone https://github.com/lornwolf/claude-hud.git && node claude-hud/custom/install.mjs
//
// 从 clone 目录或插件缓存目录（<config>/plugins/cache/claude-hud/claude-hud/<版本>/custom/）运行都可以。
// 做的事：
//   1. 用 claude CLI 登记 marketplace（lornwolf/claude-hud）并安装或更新插件本体；
//      claude 不在 PATH 或失败时，退回到"本仓库目录直接当插件"（statusLine 命令里加 CLAUDE_HUD_PLUGIN_DIR）
//   2. custom/*.mjs 复制到 <config>/plugins/claude-hud/
//   3. config.json 不存在时按模板生成（externalUsagePath 换成本机绝对路径）；已存在就不动
//   4. settings.json 的 statusLine 改成一行 node 调用（改之前备份；refreshInterval 已有则保留，否则 15）
//   5. 杀掉旧的采集进程，喂一份最小 stdin 跑一次 hud-render.mjs 验证
// 选项：--no-plugin 跳过第 1 步；--repo-as-plugin 不装插件缓存，直接用本仓库目录当插件
// <config> 是 ~/.claude，设了 CLAUDE_CONFIG_DIR 时是它。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HERE, claudeConfigDir, readJson } from './hud-shared.mjs';

const REPO_ROOT = path.dirname(HERE);
const MARKETPLACE = 'lornwolf/claude-hud';
const args = new Set(process.argv.slice(2));
const log = (m) => process.stdout.write(`${m}\n`);
const fwd = (p) => p.replace(/\\/g, '/');
// Git Bash 执行 statusLine 命令：可执行文件路径用 /c/... 形式（C:\ 会被 bash 吃掉反斜杠）
const bashExe = (p) => (process.platform === 'win32' ? fwd(p).replace(/^([A-Za-z]):\//, (_, d) => `/${d.toLowerCase()}/`) : p);

function run(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', timeout: 180_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function pluginCacheDirs(configDir) {
  const cache = path.join(configDir, 'plugins', 'cache');
  const found = [];
  let markets = [];
  try { markets = fs.readdirSync(cache); } catch { return found; }
  for (const m of markets) {
    const base = path.join(cache, m, 'claude-hud');
    let versions = [];
    try { versions = fs.readdirSync(base); } catch { continue; }
    for (const v of versions) if (fs.existsSync(path.join(base, v, 'dist', 'index.js'))) found.push(path.join(base, v));
  }
  return found;
}

// ---- 1. 插件本体 ----
function installPlugin(configDir) {
  if (args.has('--repo-as-plugin')) return false;
  if (args.has('--no-plugin')) return pluginCacheDirs(configDir).length > 0;
  if (!run('claude --version').ok) {
    log('! 找不到 claude 命令，跳过插件缓存安装，改用本仓库目录作为插件');
    return false;
  }
  let r = run(`claude plugin marketplace add ${MARKETPLACE}`);
  if (!r.ok) {
    const u = run('claude plugin marketplace update claude-hud');
    log(u.ok ? '• marketplace claude-hud 已存在，已刷新' : `! marketplace 登记失败：${r.out.split('\n').pop()}`);
  } else log('• marketplace claude-hud 已登记');
  r = run('claude plugin install claude-hud@claude-hud');
  if (!r.ok) {
    const u = run('claude plugin update claude-hud@claude-hud');
    log(u.ok ? `• 插件已更新：${u.out.split('\n').pop()}` : `! 插件安装失败：${r.out.split('\n').pop()}`);
  } else log(`• 插件已安装：${r.out.split('\n').pop()}`);
  const dirs = pluginCacheDirs(configDir);
  if (!dirs.length) { log('! 插件缓存里没有 claude-hud，改用本仓库目录作为插件'); return false; }
  return true;
}

// ---- 2. 复制脚本 ----
function deployScripts(hudDir) {
  fs.mkdirSync(hudDir, { recursive: true });
  const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.mjs') && f !== 'install.mjs');
  for (const f of files) fs.copyFileSync(path.join(HERE, f), path.join(hudDir, f));
  log(`• 已复制 ${files.length} 个脚本到 ${hudDir}`);
}

// ---- 3. config.json ----
function ensureConfig(hudDir) {
  const target = path.join(hudDir, 'config.json');
  if (fs.existsSync(target)) { log('• config.json 已存在，保持不动'); return; }
  const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
  cfg.display ??= {};
  cfg.display.externalUsagePath = fwd(path.join(hudDir, 'usage-snapshot.json'));
  fs.writeFileSync(target, `${JSON.stringify(cfg, null, 2)}\n`);
  log('• 已生成 config.json');
}

// ---- 4. settings.json ----
function writeSettings(configDir, hudDir, repoAsPlugin) {
  const settingsPath = path.join(configDir, 'settings.json');
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    const text = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
    if (text.trim()) settings = JSON.parse(text);
  }
  const render = process.env.CLAUDE_CONFIG_DIR?.trim()
    ? fwd(path.join(hudDir, 'hud-render.mjs'))
    : '$HOME/.claude/plugins/claude-hud/hud-render.mjs';
  const prefix = repoAsPlugin ? `CLAUDE_HUD_PLUGIN_DIR="${fwd(REPO_ROOT)}" ` : '';
  const command = `${prefix}"${bashExe(process.execPath)}" "${render}"`;
  const old = settings.statusLine && typeof settings.statusLine === 'object' ? settings.statusLine : {};
  const statusLine = { ...old, type: 'command', command, refreshInterval: old.refreshInterval ?? 15 };
  if (JSON.stringify(old) === JSON.stringify(statusLine)) { log('• settings.json 的 statusLine 已是目标值'); return; }
  if (fs.existsSync(settingsPath)) {
    const bak = `${settingsPath}.bak.${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}`;
    fs.copyFileSync(settingsPath, bak);
    log(`• settings.json 已备份到 ${bak}`);
  }
  const target = fs.existsSync(settingsPath) ? fs.realpathSync(settingsPath) : settingsPath;
  const mode = fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : 0o600;
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ ...settings, statusLine }, null, 2)}\n`, { mode });
  fs.renameSync(temp, target);
  log(`• statusLine.command = ${command}`);
}

// ---- 5. 重启采集进程并验证 ----
function restartAndVerify(hudDir, repoAsPlugin) {
  const pid = Number.parseInt(String(readJson(path.join(hudDir, 'shared', 'collector.lock'))?.pid ?? ''), 10);
  if (Number.isInteger(pid)) { try { process.kill(pid); log(`• 已结束旧采集进程 ${pid}，下次刷新自动拉起新的`); } catch { /* 没在跑 */ } }
  const env = { ...process.env, COLUMNS: '120' };
  if (repoAsPlugin) env.CLAUDE_HUD_PLUGIN_DIR = REPO_ROOT;
  const r = spawnSync(process.execPath, [path.join(hudDir, 'hud-render.mjs')], {
    input: JSON.stringify({ cwd: REPO_ROOT, model: { display_name: 'x' } }), env, encoding: 'utf8', timeout: 30_000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, '').trim();
  log('\n验证输出：');
  log(out.split('\n').map((l) => `  ${l}`).join('\n'));
  const bad = r.status !== 0 || /\[claude-hud\] (Error|hud-render error|plugin not found)/.test(out) || !out;
  log(bad ? '\n✗ 验证未通过，请看上面的输出' : '\n✓ 安装完成。重启 Claude Code（或在会话里 /reload-plugins）后生效。');
  return !bad;
}

try {
  if (!fs.existsSync(path.join(REPO_ROOT, 'dist', 'index.js'))) throw new Error(`${REPO_ROOT} 下没有 dist/index.js，请在仓库 clone 或插件缓存目录里运行`);
  const configDir = claudeConfigDir();
  const hudDir = path.join(configDir, 'plugins', 'claude-hud');
  log(`Claude 配置目录：${configDir}\n`);
  const cached = installPlugin(configDir);
  const repoAsPlugin = !cached;
  deployScripts(hudDir);
  ensureConfig(hudDir);
  writeSettings(configDir, hudDir, repoAsPlugin);
  process.exit(restartAndVerify(hudDir, repoAsPlugin) ? 0 : 1);
} catch (e) {
  process.stderr.write(`install.mjs: ${e?.message ?? e}\n`);
  process.exit(1);
}
