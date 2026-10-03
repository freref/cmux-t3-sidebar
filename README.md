# cmux-t3-sidebar

![Starting Claude in a thread, answering a permission prompt, settling and snoozing threads, and filtering by project](demo.gif)

> [!NOTE]
> Not affiliated with T3 Code. Heavily inspired by [T3 Code](https://github.com/pingdotgg/t3code)'s sidebar; thanks to the T3 team for building it.

## Setup

Requires cmux 0.64.25 or later.

1. Copy `t3code.js` into cmux's sidebars folder:

   ```bash
   mkdir -p ~/.config/cmux/sidebars && cp t3code.js ~/.config/cmux/sidebars/
   ```

2. In cmux, right-click the sidebar toggle and pick **t3code**.
3. Recommended: merge `cmux.example.json` into `~/.config/cmux/cmux.json`. It turns on Agent Hibernation, which pauses idle agents and resumes them with `claude --resume` when you open their thread again. It also sets a matching background and names threads after their conversation.

Settings such as auto-settle days and light or dark mode are at the top of `t3code.js`.
