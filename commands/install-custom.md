---
description: Install or update my custom statusline scripts (custom/) on this machine
allowed-tools: Bash
---

Run my one-command installer for the `custom/` statusline scripts. `${CLAUDE_PLUGIN_ROOT}` is this plugin's install directory and contains `custom/install.mjs`.

1. Run with the Bash tool: `node "${CLAUDE_PLUGIN_ROOT}/custom/install.mjs" --no-plugin`
   (`--no-plugin` because the plugin itself is already installed when this command exists.)
2. Show the user the script's output as is. If the last line is `✓ 安装完成`, tell them to run `/reload-plugins` or restart Claude Code. If it is `✗ 验证未通过`, show the verification output and stop; do not run `/claude-hud:setup`, which would overwrite the custom status line.
