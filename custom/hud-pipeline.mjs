// hud-pipeline.mjs
//
// 插件 0.10.0（提交 027c0de）起 dist/index.js 的 main() 不再接受 overrides，
// 这里用 dist/ 里导出的各个模块把 main() 的流程复刻一遍，保留原来的注入口：
//   readStdin / loadConfig / getGitStatus / getUsageFromStdin / parseTranscript / log
// hud-render.mjs 和 agy-hud-render.mjs 只调用 runHud(pluginDir, overrides)，不再碰 main()。
//
// 和插件的耦合点就在本文件：跟 src/index.ts 的 main() 对照维护。升级插件后若这里报错
// （缺导出、签名变了），HUD 会退化成一行 "[claude-hud] Error: …"，照着 src/index.ts 改这里即可。
// 对照版本：0.13.0。

import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const EMPTY_TRANSCRIPT = { tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] };
const NO_COUNTS = { claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 };

export function hudDisabled(env = process.env) {
  const v = env.CLAUDE_HUD_DISABLE?.trim().toLowerCase();
  return !!v && !['0', 'false', 'off', 'no'].includes(v);
}

// 同 src/index.ts 的 needsTranscript()
function needsTranscript(config, stdin, isContextUnreported) {
  const d = config.display;
  return d.showTools || d.showSkills || d.showMcp || d.showAgents || d.showTodos
    || d.showConfigCounts || d.showSessionTokens || d.showCompactions || d.showAdvisor
    || d.showSessionStartDate || d.showLastResponseAt || d.showEffortLevel
    || d.modelSource !== 'stdin'
    || isContextUnreported(stdin);
}

// 把插件 dist/ 里要用的模块一次性 import 进来
export async function loadPlugin(pluginDir) {
  const dist = (f) => pathToFileURL(path.join(pluginDir, 'dist', f)).href;
  const names = ['stdin.js', 'config.js', 'transcript.js', 'render/index.js', 'render/activity.js',
    'config-reader.js', 'git.js', 'jj.js', 'extra-cmd.js', 'memory.js', 'auth.js', 'daily-cost.js',
    'speed.js', 'external-usage.js', 'i18n/index.js'];
  const mods = await Promise.all(names.map((n) => import(dist(n))));
  const m = Object.fromEntries(names.map((n, i) => [n, mods[i]]));
  return {
    readStdin: m['stdin.js'].readStdin,
    getUsageFromStdin: m['stdin.js'].getUsageFromStdin,
    isContextUnreported: m['stdin.js'].isContextUnreported,
    loadConfig: m['config.js'].loadConfig,
    parseTranscript: m['transcript.js'].parseTranscript,
    addSubagentEfforts: m['transcript.js'].addSubagentEfforts,
    render: m['render/index.js'].render,
    shownAgents: m['render/activity.js'].shownAgents,
    countConfigs: m['config-reader.js'].countConfigs,
    getGitStatus: m['git.js'].getGitStatus,
    getJjStatus: m['jj.js'].getJjStatus,
    isJjRepo: m['jj.js'].isJjRepo,
    parseExtraCmdArg: m['extra-cmd.js'].parseExtraCmdArg,
    runExtraCmd: m['extra-cmd.js'].runExtraCmd,
    getMemoryUsage: m['memory.js'].getMemoryUsage,
    readAuthInfo: m['auth.js'].readAuthInfo,
    getCostTotals: m['daily-cost.js'].getCostTotals,
    getOutputSpeed: m['speed.js'].getOutputSpeed,
    resolveUsage: m['external-usage.js'].resolveUsage,
    writeExternalUsageSnapshot: m['external-usage.js'].writeExternalUsageSnapshot,
    setLanguage: m['i18n/index.js'].setLanguage,
    t: m['i18n/index.js'].t,
  };
}

// 对应 src/index.ts 的 main()。overrides 里给出的函数替换插件自己的实现；可以是对象，
// 也可以是 (plugin) => 对象 的函数，这样覆盖实现里能拿到插件原版（loadPlugin 的返回值）。
// 插件的输出走 console.log（render 内部），调用方想截获请在外面换掉 console.log。
export async function runHud(pluginDir, overrides = {}) {
  if (hudDisabled()) return;
  const p = await loadPlugin(pluginDir);
  if (typeof overrides === 'function') overrides = overrides(p);
  const deps = {
    readStdin: p.readStdin,
    loadConfig: p.loadConfig,
    getGitStatus: p.getGitStatus,
    getUsageFromStdin: p.getUsageFromStdin,
    parseTranscript: p.parseTranscript,
    log: console.log,
    ...overrides,
  };

  try {
    const stdin = await deps.readStdin();
    const config = await deps.loadConfig();
    p.setLanguage(config.language);

    if (!stdin) {
      deps.log(p.t('init.initializing'));
      if (process.platform === 'darwin') deps.log(p.t('init.macosNote'));
      return;
    }

    const display = config.display;
    const now = Date.now();
    const extraCmd = p.parseExtraCmdArg();
    const transcriptPath = stdin.transcript_path ?? '';
    const readTranscript = async () => {
      const data = { ...EMPTY_TRANSCRIPT, ...(await deps.parseTranscript(transcriptPath, os.homedir())) };
      if (display.showAgents && display.showAgentEffort) await p.addSubagentEfforts(transcriptPath, p.shownAgents(data.agents, now));
      return data;
    };
    const resolveVcsStatus = async (cwd, repo) => {
      if (!cwd) return null;
      if (config.jjStatus?.enabled && p.isJjRepo(cwd)) {
        const jj = await p.getJjStatus(cwd);
        if (jj) return jj;
      }
      return config.gitStatus.enabled ? deps.getGitStatus(cwd, { lineDiffs: config.gitStatus.showFileStats, repo }) : null;
    };
    const [transcript, gitStatus, extraLabel, memoryUsage] = await Promise.all([
      needsTranscript(config, stdin, p.isContextUnreported) ? readTranscript() : EMPTY_TRANSCRIPT,
      resolveVcsStatus(stdin.cwd, stdin.workspace?.repo),
      extraCmd ? p.runExtraCmd(extraCmd) : null,
      display.showMemoryUsage && config.lineLayout === 'expanded' ? p.getMemoryUsage() : null,
    ]);

    const stdinUsage = deps.getUsageFromStdin(stdin);
    if (display.externalUsageWritePath && stdinUsage) p.writeExternalUsageSnapshot(config, stdinUsage, now);
    const usageData = display.showUsage ? p.resolveUsage(config, stdinUsage, now) : null;

    p.render({
      stdin,
      transcript,
      ...(display.showConfigCounts ? p.countConfigs(stdin.cwd) : NO_COUNTS),
      costTotals: display.showDailyCost || display.showWeeklyCost
        ? p.getCostTotals(stdin, { allowRoutedCost: display.showRoutedCost, sevenDayResetAt: usageData?.sevenDayResetAt ?? null })
        : null,
      outputSpeed: display.showSpeed ? p.getOutputSpeed(stdin, os.homedir()) : null,
      gitStatus,
      usageData,
      memoryUsage,
      config,
      extraLabel,
      authInfo: display.showAuth || display.showAuthUser ? p.readAuthInfo() : null,
    });
  } catch (error) {
    deps.log('[claude-hud] Error:', error instanceof Error ? error.message : 'Unknown error');
  }
}
