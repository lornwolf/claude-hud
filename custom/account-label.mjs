#!/usr/bin/env node
// account-label.mjs
//
// Records the logged-in Claude account (display name + email) in
// account-label.json next to this script. sys-usage-line.mjs turns it into
// claude-hud's `display.customLine` on every render — the full "<name> · <email>"
// on wide terminals, the name alone on narrow ones — so the HUD shows it at the
// end of the first line with no per-render cost. The plugin's own showAuthUser
// only shows the email local part and never the display name.
//
// Source: the oauthAccount block Claude Code keeps in {CLAUDE_CONFIG_DIR}.json
// (default ~/.claude.json). The statusline command runs this script only when
// that file is newer than account-label.stamp, i.e. after a startup or /login
// rewrote it, so the steady-state cost is a bash `-nt` test and no process.
//
// An API-key login or a missing account records empty fields, which clears the
// label.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const LABEL_PATH = path.join(HERE, 'account-label.json');
const STAMP_PATH = path.join(HERE, 'account-label.stamp');

function claudeConfigJsonPath() {
  const env = process.env.CLAUDE_CONFIG_DIR?.trim();
  const dir = env
    ? path.resolve(env.replace(/^~(?=$|[\\/])/, os.homedir()))
    : path.join(os.homedir(), '.claude');
  return `${dir}.json`;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function readAccount() {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return { displayName: '', emailAddress: '' };
  try {
    const account = JSON.parse(fs.readFileSync(claudeConfigJsonPath(), 'utf8'))?.oauthAccount ?? {};
    return { displayName: str(account.displayName), emailAddress: str(account.emailAddress) };
  } catch {
    return { displayName: '', emailAddress: '' };
  }
}

try {
  const account = readAccount();
  let current = null;
  try { current = JSON.parse(fs.readFileSync(LABEL_PATH, 'utf8')); } catch { /* first run */ }
  if (current?.displayName !== account.displayName || current?.emailAddress !== account.emailAddress) {
    const tmp = `${LABEL_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(account, null, 2)}\n`);
    fs.renameSync(tmp, LABEL_PATH);
  }
  fs.writeFileSync(STAMP_PATH, `${new Date().toISOString()}\n`);
} catch {
  // leave account-label.json and the stamp untouched; the next render retries
}
