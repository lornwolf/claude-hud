#!/usr/bin/env node
// fable-usage-feeder.mjs
//
// Fetches per-model weekly quota (e.g. "Fable") from the Claude OAuth usage API
// and writes a snapshot file that claude-hud >= 0.8.0 reads natively via
// `display.externalUsagePath`. Lives OUTSIDE the plugin cache directory so it
// survives plugin upgrades (the 0.3.0 approach patched dist/ and was lost on
// every version bump).
//
// Invoked by the statusline command (see ~/.claude/settings.json) only when the
// stamp file is older than a few minutes, so the HUD render path never waits on
// the network. Run manually with `bun fable-usage-feeder.mjs --force` to test.
//
// Output: <this dir>/usage-snapshot.json
//   {
//     "updated_at": ISO,
//     "five_hour":  { "used_percentage": n, "resets_at": ISO },
//     "seven_day":  { "used_percentage": n, "resets_at": ISO },
//     "model_scoped": [ { "display_name": "Fable Weekly", "utilization": n, "resets_at": ISO } ]
//   }

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as https from 'node:https';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SNAPSHOT_PATH = path.join(HERE, 'usage-snapshot.json');
const STAMP_PATH = path.join(HERE, 'usage-feeder.stamp');
const LOCK_PATH = path.join(HERE, 'usage-feeder.lock');
const LOG_PATH = path.join(HERE, 'usage-feeder.log');

const REFRESH_MS = 5 * 60_000;      // matches the usage API rate-limit window
const LOCK_STALE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;
const LOG_MAX_BYTES = 64 * 1024;

const force = process.argv.includes('--force');

function log(msg) {
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > LOG_MAX_BYTES) {
      fs.rmSync(LOG_PATH, { force: true });
    }
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // never fail because of logging
  }
}

function mtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function touchStamp() {
  try {
    fs.writeFileSync(STAMP_PATH, `${new Date().toISOString()}\n`);
  } catch {
    // ignore
  }
}

function acquireLock() {
  try {
    fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    if (Date.now() - mtimeMs(LOCK_PATH) > LOCK_STALE_MS) {
      try {
        fs.rmSync(LOCK_PATH, { force: true });
        fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

function releaseLock() {
  try {
    fs.rmSync(LOCK_PATH, { force: true });
  } catch {
    // ignore
  }
}

function claudeConfigDir() {
  const env = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (env) {
    return path.resolve(env.replace(/^~(?=$|[\\/])/, os.homedir()));
  }
  return path.join(os.homedir(), '.claude');
}

function readAccessToken() {
  const credPath = path.join(claudeConfigDir(), '.credentials.json');
  const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const oauth = raw?.claudeAiOauth;
  const token = oauth?.accessToken;
  if (typeof token !== 'string' || !token) {
    throw new Error('no accessToken in .credentials.json');
  }
  if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now()) {
    throw new Error('accessToken expired; waiting for Claude Code to refresh it');
  }
  return token;
}

function fetchUsage(token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/api/oauth/usage',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`http-${res.statusCode}${res.statusCode === 429 ? ` retry-after=${res.headers['retry-after'] ?? '?'}` : ''}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`invalid json: ${e.message}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function pct(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(100, Math.max(0, v))) : null;
}

function iso(v) {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function buildSnapshot(api, now) {
  const scoped = [];
  for (const lim of Array.isArray(api.limits) ? api.limits : []) {
    if (lim?.kind !== 'weekly_scoped') continue;
    const model = lim.scope?.model?.display_name;
    if (typeof model !== 'string' || !model.trim()) continue;
    const utilization = pct(lim.percent);
    if (utilization === null) continue;
    scoped.push({
      display_name: `${model.trim()} Weekly`,
      utilization,
      resets_at: iso(lim.resets_at),
    });
  }

  return {
    updated_at: new Date(now).toISOString(),
    five_hour: {
      used_percentage: pct(api.five_hour?.utilization),
      resets_at: iso(api.five_hour?.resets_at),
    },
    seven_day: {
      used_percentage: pct(api.seven_day?.utilization),
      resets_at: iso(api.seven_day?.resets_at),
    },
    model_scoped: scoped,
  };
}

function writeSnapshotAtomic(snapshot) {
  const tmp = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, SNAPSHOT_PATH);
}

async function main() {
  const now = Date.now();
  if (!force && now - mtimeMs(STAMP_PATH) < REFRESH_MS) {
    return; // attempted recently (success or failure); let the HUD use what it has
  }
  if (!acquireLock()) {
    return; // another feeder is running
  }
  try {
    touchStamp();
    const token = readAccessToken();
    const api = await fetchUsage(token);
    const snapshot = buildSnapshot(api, now);
    writeSnapshotAtomic(snapshot);
    log(`ok 5h=${snapshot.five_hour.used_percentage}% 7d=${snapshot.seven_day.used_percentage}% scoped=${snapshot.model_scoped.map((s) => `${s.display_name}:${s.utilization}%`).join(',') || 'none'}`);
    if (force) {
      console.log(JSON.stringify(snapshot, null, 2));
    }
  } catch (e) {
    log(`fail ${e.message}`);
    if (force) {
      console.error(`fable-usage-feeder: ${e.message}`);
      process.exitCode = 1;
    }
  } finally {
    releaseLock();
  }
}

main();
