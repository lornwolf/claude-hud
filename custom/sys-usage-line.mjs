#!/usr/bin/env node
// sys-usage-line.mjs
//
// Prints one extra statusline row with host CPU and RAM usage, styled like
// claude-hud's own progress lines (dim label, █░ quota bar, quota colors).
// Invoked by the statusline command right after claude-hud so it lands on the
// last line. Lives outside the plugin cache dir so plugin upgrades keep it.
//
// CPU% is derived from the os.cpus() tick delta since the previous render,
// persisted in cpu-sample.json next to this file. Very short deltas reuse the
// previous value to avoid jitter.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SAMPLE_PATH = path.join(HERE, 'cpu-sample.json');
const CONFIG_PATH = path.join(HERE, 'config.json');

const MIN_SAMPLE_GAP_MS = 250;

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const NAMED = {
  dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', brightBlue: '\x1b[94m', brightMagenta: '\x1b[95m',
};

function resolveAnsi(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return `\x1b[38;5;${value}m`;
  if (typeof value === 'string' && value.startsWith('#') && value.length === 7) {
    const r = parseInt(value.slice(1, 3), 16), g = parseInt(value.slice(3, 5), 16), b = parseInt(value.slice(5, 7), 16);
    return `\x1b[38;2;${r};${g};${b}m`;
  }
  return NAMED[value] ?? fallback;
}

function readColors() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return cfg?.colors ?? {};
  } catch {
    return {};
  }
}

function quotaColor(percent, colors) {
  if (percent >= 90) return resolveAnsi(colors.critical, NAMED.red);
  if (percent >= 75) return resolveAnsi(colors.usageWarning, NAMED.brightMagenta);
  return resolveAnsi(colors.usage, NAMED.brightBlue);
}

function quotaBar(percent, width, colors, color = quotaColor(percent, colors)) {
  const p = Math.min(100, Math.max(0, percent));
  const filled = Math.round((p / 100) * width);
  const filledChar = colors.barFilled ?? '█';
  const emptyChar = colors.barEmpty ?? '░';
  return `${color}${filledChar.repeat(filled)}${DIM}${emptyChar.repeat(width - filled)}${RESET}`;
}

// macOS keeps otherwise-idle RAM busy as file cache, so "used %" sits near
// 100% on a perfectly healthy machine. The kernel's own memory-pressure level
// (what Activity Monitor's pressure graph plots) is the real signal:
//   1 normal (green)  2 warning (yellow)  3 urgent / 4 critical (red)
// Returns null off macOS or when sysctl fails, so callers fall back to percent.
function macMemoryPressureLevel() {
  if (process.platform !== 'darwin') return null;
  try {
    const out = execFileSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'],
      { encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] });
    const level = Number.parseInt(out.trim(), 10);
    return Number.isFinite(level) && level >= 1 ? level : null;
  } catch {
    return null;
  }
}

// RAM color: on macOS follow the pressure level (percent alone would always be
// red there); elsewhere keep the percent thresholds shared with CPU/quota.
function memColor(percent, colors) {
  const level = macMemoryPressureLevel();
  if (level === null) return quotaColor(percent, colors);
  if (level >= 3) return resolveAnsi(colors.critical, NAMED.red);
  if (level === 2) return resolveAnsi(colors.usageWarning, NAMED.brightMagenta);
  return resolveAnsi(colors.usage, NAMED.brightBlue);
}

function barWidth() {
  const cols = Number.parseInt(process.env.COLUMNS ?? '', 10);
  if (Number.isFinite(cols) && cols > 0) {
    if (cols >= 100) return 10;
    if (cols >= 60) return 6;
    return 4;
  }
  return 10;
}

function cpuTicks() {
  let idle = 0, total = 0;
  for (const cpu of os.cpus()) {
    for (const [k, v] of Object.entries(cpu.times)) {
      total += v;
      if (k === 'idle') idle += v;
    }
  }
  return { idle, total };
}

function cpuPercent() {
  const now = Date.now();
  const cur = cpuTicks();
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
  } catch {
    // first run
  }

  let percent = null;
  if (prev && typeof prev.idle === 'number' && typeof prev.total === 'number') {
    const elapsed = now - (prev.ts ?? 0);
    const dTotal = cur.total - prev.total;
    const dIdle = cur.idle - prev.idle;
    if (elapsed < MIN_SAMPLE_GAP_MS || dTotal <= 0) {
      // Too soon for a meaningful delta: keep the previous reading and sample.
      return typeof prev.percent === 'number' ? prev.percent : null;
    }
    percent = Math.round(Math.min(100, Math.max(0, (1 - dIdle / dTotal) * 100)));
  }

  try {
    fs.writeFileSync(SAMPLE_PATH, JSON.stringify({ ...cur, ts: now, percent }));
  } catch {
    // ignore
  }
  return percent;
}

function gb(bytes) {
  return `${(bytes / 2 ** 30).toFixed(1)} GB`;
}

// Swap in use, in bytes: { used, total } or null when unknown.
// macOS: `sysctl vm.swapusage` -> "total = 2048.00M  used = 1234.50M  free = ...";
//   total grows on demand, so only `used` is meaningful there.
// Linux: /proc/meminfo SwapTotal/SwapFree (kB).
// Windows: omitted (Win32_PageFileUsage needs PowerShell/WMI, too slow per render).
function swapUsage() {
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('sysctl', ['-n', 'vm.swapusage'],
        { encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] });
      const num = (key) => {
        const m = out.match(new RegExp(`${key}\\s*=\\s*([\\d.]+)([KMGT]?)`));
        if (!m) return null;
        const mult = { '': 1, K: 2 ** 10, M: 2 ** 20, G: 2 ** 30, T: 2 ** 40 }[m[2]];
        return Number.parseFloat(m[1]) * mult;
      };
      const used = num('used'), total = num('total');
      return used === null ? null : { used, total };
    }
    if (process.platform === 'linux') {
      const info = fs.readFileSync('/proc/meminfo', 'utf8');
      const kb = (key) => {
        const m = info.match(new RegExp(`^${key}:\\s*(\\d+) kB`, 'm'));
        return m ? Number.parseInt(m[1], 10) * 1024 : null;
      };
      const total = kb('SwapTotal'), free = kb('SwapFree');
      if (total === null || free === null) return null;
      return { used: total - free, total };
    }
  } catch { /* fall through */ }
  return null;
}

// CPU temperature, tried in order:
//   1. LibreHardwareMonitor's local web server (http://127.0.0.1:8085/data.json,
//      registered as an elevated logon task) — real CPU Package sensor.
//   2. Windows, no admin needed: the ACPI thermal zone performance counter
//      (\Thermal Zone Information(*)\High Precision Temperature) via typeperf.
//      typeperf takes ~2 s, so it is spawned in the background and only the
//      cached result (acpi-temp.csv next to this file) is read at render time.
//   3. Linux: /sys/class/thermal/thermal_zone*/temp (prefers x86_pkg_temp).
// Returns null quietly when nothing is available.
const LHM_URL = 'http://127.0.0.1:8085/data.json';
const LHM_SENSOR_ID = '/intelcpu/0/temperature/8'; // "CPU Package"
const LHM_TIMEOUT_MS = 400;

const ACPI_CSV_PATH = path.join(HERE, 'acpi-temp.csv');
const ACPI_REFRESH_MS = 30_000;      // re-sample when the cache is older than this
const ACPI_SPAWN_GAP_MS = 10_000;    // never spawn typeperf more often than this
const ACPI_STALE_MS = 5 * 60_000;    // hide the value when the cache is this old

async function fetchCpuTemp() {
  const lhm = await fetchLhmTemp();
  if (lhm !== null) return lhm;
  if (process.platform === 'win32') return acpiTempWindows();
  if (process.platform === 'linux') return sysfsTempLinux();
  return null;
}

async function fetchLhmTemp() {
  try {
    const res = await fetch(LHM_URL, { signal: AbortSignal.timeout(LHM_TIMEOUT_MS) });
    if (!res.ok) return null;
    const root = await res.json();
    let fallback = null;
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== 'object') continue;
      if (n.SensorId === LHM_SENSOR_ID) return parseTemp(n.Value);
      if (n.Type === 'Temperature' && n.Text === 'CPU Package' && fallback === null) fallback = parseTemp(n.Value);
      if (Array.isArray(n.Children)) stack.push(...n.Children);
    }
    return fallback;
  } catch {
    return null;
  }
}

function parseTemp(v) {
  const m = String(v ?? '').match(/-?\d+(\.\d+)?/);
  return m ? Math.round(Number(m[0])) : null;
}

// Windows fallback: read the cached typeperf CSV, refresh it in the background.
function acpiTempWindows() {
  const now = Date.now();
  const csvAge = now - mtimeMs(ACPI_CSV_PATH);
  if (csvAge > ACPI_REFRESH_MS && now - mtimeMs(`${ACPI_CSV_PATH}.stamp`) > ACPI_SPAWN_GAP_MS) {
    spawnAcpiSampler();
  }
  if (csvAge > ACPI_STALE_MS) return null;
  return parseAcpiCsv();
}

function mtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function spawnAcpiSampler() {
  try {
    fs.writeFileSync(`${ACPI_CSV_PATH}.stamp`, String(Date.now()));
    const hp = '\\Thermal Zone Information(*)\\High Precision Temperature';
    const lo = '\\Thermal Zone Information(*)\\Temperature';
    // High Precision (tenths of a kelvin) exists on Windows 10 1809+; fall back to whole kelvins.
    const cmd = `typeperf "${hp}" -sc 1 -y -o "${ACPI_CSV_PATH}" || typeperf "${lo}" -sc 1 -y -o "${ACPI_CSV_PATH}"`;
    // No `detached`: on Windows it maps to DETACHED_PROCESS, which leaves cmd.exe with no
    // console at all, so typeperf (a console app) gets a new, visible console window.
    // With windowsHide + ignored stdio, cmd.exe gets a hidden console that typeperf inherits.
    // The child still outlives this process (Windows does not kill children on parent exit).
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], {
      stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
    });
    child.unref();
  } catch {
    // ignore
  }
}

// typeperf CSV: header row of counter names, then one data row. Several zones may be
// reported (\_TZ.TZ0, \_TZ.TZ1 ...); take the hottest one, which is the CPU zone in practice.
function parseAcpiCsv() {
  try {
    const lines = fs.readFileSync(ACPI_CSV_PATH, 'utf8').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return null;
    const headers = splitCsv(lines[0]);
    const values = splitCsv(lines[lines.length - 1]);
    let best = null;
    for (let i = 1; i < headers.length && i < values.length; i++) {
      const raw = Number(values[i]);
      if (!Number.isFinite(raw) || raw <= 0) continue;
      const kelvin = /High Precision/i.test(headers[i]) ? raw / 10 : raw;
      const c = kelvin - 273.15;
      if (c < 0 || c > 150) continue;
      if (best === null || c > best) best = c;
    }
    return best === null ? null : Math.round(best);
  } catch {
    return null;
  }
}

function splitCsv(line) {
  return line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
}

// Linux fallback: sysfs thermal zones, prefer the CPU package zone.
function sysfsTempLinux() {
  try {
    const base = '/sys/class/thermal';
    const preferred = ['x86_pkg_temp', 'cpu-thermal', 'cpu_thermal', 'soc_thermal', 'acpitz'];
    let best = null;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const name of fs.readdirSync(base)) {
      if (!name.startsWith('thermal_zone')) continue;
      let type = '';
      try {
        type = fs.readFileSync(path.join(base, name, 'type'), 'utf8').trim();
      } catch {
        // ignore
      }
      const raw = Number(fs.readFileSync(path.join(base, name, 'temp'), 'utf8').trim());
      if (!Number.isFinite(raw)) continue;
      const c = raw > 1000 ? raw / 1000 : raw;
      if (c <= 0 || c > 150) continue;
      const idx = preferred.indexOf(type);
      const rank = idx === -1 ? preferred.length : idx;
      // Lower rank wins; among equal rank keep the hottest.
      if (rank < bestRank || (rank === bestRank && c > best)) {
        best = c;
        bestRank = rank;
      }
    }
    return best === null ? null : Math.round(best);
  } catch {
    return null;
  }
}

// 农历日：1..30 -> 初一..三十
function lunarDayName(n) {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (n <= 10) return `初${digits[n]}`;
  if (n < 20) return `十${digits[n - 10]}`;
  if (n === 20) return '二十';
  if (n < 30) return `廿${digits[n - 20]}`;
  return '三十';
}

// 农历 (month, day, leap) —— month 1..12，闰月 leap=true
function lunarParts(date) {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'numeric', day: 'numeric' }).formatToParts(date);
    const mRaw = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = Number.parseInt(parts.find((p) => p.type === 'day')?.value ?? '', 10);
    const leap = /^\D/.test(mRaw);
    const month = Number.parseInt(mRaw.replace(/^\D+/, ''), 10);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { month, day, leap };
  } catch {
    return null;
  }
}

// 清明 / 冬至：21 世纪通用公式 day = floor(Y*0.2422 + C) - floor(Y/4)，Y 为两位年份
function solarTermDay(year, C) {
  const Y = year % 100;
  return Math.floor(Y * 0.2422 + C) - Math.floor(Y / 4);
}

// 当天的中国传统节日名，没有则 null
function chineseFestival(now, lunar) {
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  if (m === 4 && d === solarTermDay(y, 4.81)) return '清明节';
  if (m === 12 && d === solarTermDay(y, 21.94)) return '冬至';
  if (!lunar || lunar.leap) return null;
  const key = `${lunar.month}-${lunar.day}`;
  const table = {
    '1-1': '春节', '1-15': '元宵节', '2-2': '龙抬头', '5-5': '端午节',
    '7-7': '七夕', '7-15': '中元节', '8-15': '中秋节', '9-9': '重阳节',
    '12-8': '腊八节', '12-23': '小年',
  };
  if (table[key]) return table[key];
  if (lunar.month === 12) {
    const next = lunarParts(new Date(now.getTime() + 24 * 3600 * 1000));
    if (next && next.month === 1 && next.day === 1 && !next.leap) return '除夕';
  }
  return null;
}

// 节日颜色：按日期做种子的伪随机色，同一天颜色固定；高亮度饱和色，黑底可读
function festivalColor(now) {
  let seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  seed = (seed * 2654435761) >>> 0;
  const h = seed % 360, s = 0.85, l = 0.65;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), mm = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round((v + mm) * 255);
  return `\x1b[1;38;2;${to(r1)};${to(g1)};${to(b1)}m`;
}

// "今天是2026年9月9日，农历七月廿八，星期三。"（节日时："…农历八月十五（中秋节），星期五。"）
function dateLine(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  const weekdayText = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now);
  // 周一到周日依次用赤橙黄绿青蓝紫（24 位色）
  const WEEK_COLORS = {
    1: '\x1b[38;2;229;72;77m',   // 赤
    2: '\x1b[38;2;247;107;21m',  // 橙
    3: '\x1b[38;2;245;217;10m',  // 黄
    4: '\x1b[38;2;48;164;108m',  // 绿
    5: '\x1b[38;2;18;165;148m',  // 青
    6: '\x1b[38;2;62;99;221m',   // 蓝
    0: '\x1b[38;2;142;78;198m',  // 紫（周日）
  };
  const weekday = `${WEEK_COLORS[now.getDay()] ?? ''}${weekdayText}${RESET}`;
  let lunar = '';
  try {
    const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' }).formatToParts(now);
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = Number.parseInt(parts.find((p) => p.type === 'day')?.value ?? '', 10);
    if (month && Number.isFinite(day)) {
      lunar = `农历${month}${lunarDayName(day)}`;
    }
  } catch {
    // ICU without the chinese calendar: omit the lunar part
  }
  const festival = chineseFestival(now, lunarParts(now));
  const festivalPart = festival ? `（${festivalColor(now)}${festival}${RESET}）` : '';
  const lunarPart = lunar ? `${lunar}${festivalPart}，` : (festival ? `${festivalPart}，` : '');
  return `今天是${y}年${m}月${d}日，${lunarPart}${weekday}。`;
}

async function main() {
  const colors = readColors();
  const width = barWidth();
  const labelColor = resolveAnsi(colors.label, DIM);
  const label = (t) => `${labelColor}${t}${RESET}`;
  const pct = (p) => `${quotaColor(p, colors)}${p}%${RESET}`;

  const tempPromise = fetchCpuTemp();
  const cpu = cpuPercent();
  const temp = await tempPromise;
  // Temperature reuses the quota palette: <75 normal, 75-89 warning, >=90 critical.
  const tempPart = temp === null ? '' : ` ${quotaColor(temp, colors)}${temp}°C${RESET}`;
  const cpuPart = cpu === null
    ? `${label('CPU')} ${quotaBar(0, width, colors)} ${label('--')}${tempPart}`
    : `${label('CPU')} ${quotaBar(cpu, width, colors)} ${pct(cpu)}${tempPart}`;

  const total = os.totalmem();
  const free = Math.min(Math.max(os.freemem(), 0), total);
  const used = total - free;
  const memPercent = Math.round((used / total) * 100);
  const memCol = memColor(memPercent, colors);
  const memPart = `${label('RAM')} ${quotaBar(memPercent, width, colors, memCol)} ${memCol}${memPercent}%${RESET} ${label(`(${gb(used)} / ${gb(total)})`)}`;

  // Swap: on macOS show only the amount in use (total is elastic); on Linux
  // used / total. Colored with the RAM color so heavy swapping under pressure
  // reads red, and dim like a label when swap is idle.
  const swap = swapUsage();
  let swapPart = '';
  if (swap) {
    const swapText = process.platform === 'darwin' || !swap.total
      ? gb(swap.used)
      : `${gb(swap.used)} / ${gb(swap.total)}`;
    const swapCol = swap.used > 0 ? memCol : labelColor;
    swapPart = ` │ ${label('Swap')} ${swapCol}${swapText}${RESET}`;
  }

  // SYSLINE_DATE=YYYY-MM-DD 仅用于测试日期行
  const testDate = process.env.SYSLINE_DATE ? new Date(`${process.env.SYSLINE_DATE}T12:00:00`) : null;
  const dl = testDate && !Number.isNaN(testDate.getTime()) ? dateLine(testDate) : dateLine();
  process.stdout.write(`${dl}\n${cpuPart} │ ${memPart}${swapPart}\n`);
}

main();
