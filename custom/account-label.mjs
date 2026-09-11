#!/usr/bin/env node
// account-label.mjs
//
// Syncs the logged-in Claude account into claude-hud's config.json as
// `display.customLine` ("<displayName> · <emailAddress>"), which the HUD renders
// at the end of the first line with no per-render cost. The plugin's own
// showAuthUser only shows the email local part and never the display name.
//
// Source: the oauthAccount block Claude Code keeps in {CLAUDE_CONFIG_DIR}.json
// (default ~/.claude.json). The statusline command runs this script only when
// that file is newer than account-label.stamp, i.e. after a startup or /login
// rewrote it, so the steady-state cost is a bash `-nt` test and no process.
//
// config.json is rewritten only when the label actually changed. An API-key
// login or a missing account clears the label.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const CONFIG_PATH = path.join(HERE, 'config.json');
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

function readLabel() {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return '';
  try {
    const account = JSON.parse(fs.readFileSync(claudeConfigJsonPath(), 'utf8'))?.oauthAccount ?? {};
    return [str(account.displayName), str(account.emailAddress)].filter(Boolean).join(' · ');
  } catch {
    return '';
  }
}

try {
  const label = readLabel();
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  config.display ??= {};
  if ((config.display.customLine ?? '') !== label) {
    config.display.customLine = label;
    config.display.customLinePosition = 'last';
    const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
    fs.renameSync(tmp, CONFIG_PATH);
  }
  fs.writeFileSync(STAMP_PATH, `${new Date().toISOString()}\n`);
} catch {
  // leave config.json and the stamp untouched; the next render retries
}
