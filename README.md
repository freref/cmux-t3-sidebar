# cmux-t3-sidebar

[T3 Code](https://github.com/pingdotgg/t3code)'s thread sidebar for [cmux](https://cmux.com), with settle, snooze and a project filter.

Unofficial: not affiliated with T3 Code or cmux. The design, status badges and palette come from T3 Code by T3 Tools Inc.; thanks to them for building it.

## Setup

Requires cmux 0.64.25 or later.

1. Copy `t3code.js` into cmux's sidebars folder:

   ```bash
   mkdir -p ~/.config/cmux/sidebars && cp t3code.js ~/.config/cmux/sidebars/
   ```

2. In cmux, right-click the sidebar toggle and pick **t3code**.
3. Optional: merge `cmux.example.json` into `~/.config/cmux/cmux.json` for T3's background, conversation titles and Agent Hibernation.

Settings such as auto-settle days and light or dark mode are at the top of `t3code.js`.

Settled threads stay open as cmux workspaces. With Agent Hibernation on, cmux stops the longest-idle agents once more than 4 are running, and resumes each one with `claude --resume <id>` when you open it again.
