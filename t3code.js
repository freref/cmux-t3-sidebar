// T3 Code's thread sidebar for cmux.
//
// A thread is a cmux workspace. Where it sits (open, snoozed, settled) is one
// marker line at the end of the workspace's description, the only thing a
// sidebar can make cmux save. A settled thread's workspace is closed: what
// stays is a record (title, folder, agent sessions) the thread reopens from, so
// cmux only ever holds the threads you have open.

// ── Settings ────────────────────────────────────────────────────────────────

const AUTO_SETTLE_AFTER_DAYS = 3; // settle a thread this long after your last prompt; null = never
const AUTO_SETTLE_ON_MERGE = true; // settle when its pull request merges (closed ones always settle)
const CLOSE_SETTLED = true; // a settled thread's workspace closes, and opening the thread resumes its sessions in a new one; false keeps them open
const MAX_SETTLED_THREADS = 500; // closed settled threads the sidebar remembers, newest first; null = all
const NEW_THREAD_COMMAND = "claude"; // run in a new project thread ("No project" threads stay a plain shell); null = plain shell
const SPLIT_NEW_THREAD_RATIO = 2; // a new thread opens as two panes side by side when the window is this many times wider than tall; null = one pane
const APPEARANCE = "light"; // "light" | "dark": a sidebar can't tell which one macOS is in

const SETTLED_PAGE = 10;
const SETTLED_STEP = 25;
const NOTICE_SECONDS = 5;
const OPEN_GRACE = 600; // a settled thread you opened stays open this long after you leave it
const ECHO_SECONDS = 10; // how long cmux gets to show a description we wrote
const CARRIERS = 2; // workspaces that hold a copy of the favorites and settled records

// ── Look ────────────────────────────────────────────────────────────────────

const INFO = "#3b82f6";
const SUCCESS = "#10b981";
const WARNING = "#f59e0b";
const INPUT = "#6366f1";
const BACKGROUND = "#06b6d4";
const SELECTION = "#4C9EEB33";
const PALETTE = {
  light: { rowActive: "#FFFFFF", rowHover: "#FCFCFC", fg: "#27272A", muted: "#71717A", faint: "#71717A99", control: "#71717A1F" },
  dark: { rowActive: "#FFFFFF0A", rowHover: "#FFFFFF0A", fg: "#F5F5F5", muted: "#8C8C8C", faint: "#8C8C8C99", control: "#FFFFFF14" },
}[APPEARANCE];
const PR_COLORS = { open: "#10b981", closed: "#ef4444", merged: "#8b5cf6" };
// Every pair is at least 0.1 apart in OKLab, so they stay distinct at badge size.
const PROJECT_COLORS = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#10b981", "#06b6d4", "#3b82f6", "#8b5cf6", "#d946ef", "#ec4899"];
const STATUS = {
  input: { icon: "questionmark.bubble", color: INPUT, text: "Input" },
  working: { icon: "circle.dashed", color: INFO, text: "Working" },
  woke: { icon: "alarm", color: WARNING, text: "Woke" },
  monitoring: { icon: "waveform.path.ecg", color: BACKGROUND, text: "Monitoring" },
  background: { icon: "hourglass", color: BACKGROUND, text: "Background" },
  done: { icon: "checkmark.circle", color: SUCCESS, text: "Done" },
};
// Row heights are fixed: the menus that float over the list are placed by them.
const CARD_H = 78;
const SLIM_H = 36;
const NOTICE_H = 36;
const ROW_GAP = 2;

// ── Time ────────────────────────────────────────────────────────────────────

const sec = (t) => (t > 1e12 ? Math.floor(t / 1000) : Math.floor(t));
const pad2 = (n) => (n < 10 ? "0" : "") + n;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function clockTime(epoch) {
  const d = new Date(epoch * 1000);
  return d.getHours() + ":" + pad2(d.getMinutes());
}
function dayTime(epoch, t) {
  const d = new Date(epoch * 1000);
  const sameDay = d.toDateString() === new Date(t * 1000).toDateString();
  return sameDay ? clockTime(epoch) : DAYS[d.getDay()] + " " + clockTime(epoch);
}
function relative(then, t) {
  if (!then) return "";
  const d = t - then;
  if (d < 60) return "now";
  if (d < 3600) return Math.floor(d / 60) + "m";
  if (d < 86400) return Math.floor(d / 3600) + "h";
  return Math.floor(d / 86400) + "d";
}
function duration(s) {
  s = Math.max(0, Math.floor(s));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  return m < 60 ? m + "m" : Math.floor(m / 60) + "h " + (m % 60) + "m";
}
function countdown(until, t) {
  const d = until - t;
  if (d < 3600) return Math.max(1, Math.ceil(d / 60)) + "m";
  if (d < 86400) return Math.ceil(d / 3600) + "h";
  return Math.ceil(d / 86400) + "d";
}
function snoozePresets(t) {
  const base = new Date(t * 1000);
  const at = (days, hour) => {
    const x = new Date(base);
    x.setDate(x.getDate() + days);
    x.setHours(hour, 0, 0, 0);
    return Math.floor(x.getTime() / 1000);
  };
  const out = [
    { label: "In 1 hour", at: t + 3600, time: clockTime(t + 3600) },
    { label: "In 3 hours", at: t + 3 * 3600, time: clockTime(t + 3 * 3600) },
  ];
  const evening = at(0, 18);
  if (evening - t > 3600) out.push({ label: "This evening", at: evening, time: clockTime(evening) });
  const tomorrow = at(1, 9);
  out.push({ label: "Tomorrow", at: tomorrow, time: clockTime(tomorrow) });
  if (base.getDay() !== 0) {
    const monday = at((8 - base.getDay()) % 7 || 7, 9);
    out.push({ label: "Next week", at: monday, time: "Mon " + clockTime(monday) });
  }
  return out;
}
// A duration ("45m", "2h", "3d") or a clock time ("17:30").
function parseCustomSnooze(text, t) {
  const s = (text ?? "").trim().toLowerCase();
  let m = /^(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)$/.exec(s);
  if (m) {
    const unit = m[2][0] === "m" ? 60 : m[2][0] === "h" ? 3600 : 86400;
    const at = Math.round(t + parseFloat(m[1]) * unit);
    return at > t ? at : null;
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m && +m[1] < 24 && +m[2] < 60) {
    const x = new Date(t * 1000);
    x.setHours(+m[1], +m[2], 0, 0);
    const at = Math.floor(x.getTime() / 1000);
    return at <= t ? at + 86400 : at;
  }
  return null;
}

// ── Projects ────────────────────────────────────────────────────────────────

const NO_PROJECT = "No project";
const pathSegments = (dir) => String(dir ?? "").split("/").filter(Boolean);
const baseName = (dir) => pathSegments(dir).pop() ?? "";
function monogram(name) {
  const words = String(name ?? "").normalize("NFKC").trim().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words[0]) return "PR";
  const glyphs = Array.from(words[0]);
  const first = glyphs[0] ?? "P";
  const second =
    glyphs.slice(1).find((g) => /\p{N}/u.test(g)) ??
    (words.length > 1 ? Array.from(words[words.length - 1])[0] : glyphs[glyphs.length - 1]) ??
    first;
  return Array.from((first + second).toUpperCase()).slice(0, 2).join("");
}
function projectColor(dir) {
  let h = 0x811c9dc5;
  for (const ch of String(dir ?? "")) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193);
  return PROJECT_COLORS[(h >>> 0) % PROJECT_COLORS.length];
}
// A project's label is its folder name, plus parent folders only when another
// project shares that name.
function projectLabels(dirs) {
  const segs = new Map(dirs.map((d) => [d, pathSegments(d)]));
  const tail = (d, n) => segs.get(d).slice(-n).join("/");
  const labels = new Map();
  for (const d of dirs) {
    let n = 1;
    while (n < segs.get(d).length && dirs.some((o) => o !== d && tail(o, n) === tail(d, n))) n++;
    labels.set(d, tail(d, n));
  }
  return labels;
}

// ── Reactive helpers ────────────────────────────────────────────────────────

// A signal the engine can also read without subscribing to it.
function box(initial) {
  let value = initial;
  const [read, write] = signal(initial);
  return {
    get: read,
    peek: () => value,
    set(next) {
      value = next;
      write(next);
    },
  };
}
// A derived value that only tells its readers when it really changed.
function memo(fn, same = Object.is) {
  let value;
  let primed = false;
  const [read, write] = signal(undefined);
  computed(() => {
    const next = fn();
    if (!primed || !same(value, next)) {
      primed = true;
      value = next;
      write(next);
    }
    return 0;
  });
  return read;
}
const sameKeys = (a, b) => a.length === b.length && a.every((x, i) => x.key === b[i].key);
// One effect computes everything a row shows, and each value is its own
// signal: a binding re-runs, and cmux redraws, only when its value changed.
// `compute` must return the same keys, with plain values, every time.
function fields(compute) {
  const read = {};
  const write = {};
  computed(() => {
    const next = compute();
    for (const key in next) {
      if (write[key]) write[key](next[key]);
      else [read[key], write[key]] = signal(next[key]);
    }
    return 0;
  });
  return read;
}
// The runtime has no conditional view: a list of one or none stands in. Only
// for views that are always mounted (cmux leaks rows a list inside a row
// mounts later).
function when(cond, key, build) {
  return ForEach({ items: () => (cond() ? [key] : []), key: (k) => k }, () => build());
}

// ── Markers ─────────────────────────────────────────────────────────────────

// The last line of a workspace's description says where its thread is:
//   [t3 settled=<when> last=<last prompt>]
//   [t3 snoozed=<until> at=<when> last=<last prompt>]
//   [t3 manual=1 last=<last prompt>]   you un-settled it: never auto-settle
//   [t3 last=<last prompt>]            cmux doesn't keep prompt times itself
// A thread reopened from a settled record names it with `from` for as long
// as it stays settled, and `top` asks for one move to the top. The syntax is a
// contract with what's already saved: changing it needs a migration.
const MARK_KEYS = ["settled", "snoozed", "at", "manual", "last", "slept", "from", "top"];
const MARK_LINE = /^\[t3((?: [a-z]+=\d+)*)\]$/;
const SHARED_LINE = /^\[t3:(rev|fav|arc) /;
// Written by the version that kept settled threads open and exited their
// Claude: the sessions to resume, or just `slept=` in the marker. Kept until
// the thread closes or un-settles.
const SLEPT_LINE = /^\[t3:slept \S+ \d+ (\S+) \d+\]$/;
function parseDescription(text) {
  const user = [];
  const block = [];
  const slept = [];
  let mark = {};
  for (const line of text.split("\n")) {
    if (!line.startsWith("[t3")) {
      user.push(line);
      continue;
    }
    const m = MARK_LINE.exec(line);
    if (m) {
      mark = {};
      for (const pair of m[1].trim().split(" ").filter(Boolean)) {
        const [k, v] = pair.split("=");
        if (MARK_KEYS.includes(k)) mark[k] = +v;
      }
    } else if (SHARED_LINE.test(line)) {
      block.push(line);
    } else if (SLEPT_LINE.test(line)) {
      slept.push(line);
    }
  }
  return { user: user.join("\n"), block: block.join("\n"), slept: slept.join("\n"), mark };
}
function formatMark(mark) {
  const parts = MARK_KEYS.filter((k) => mark[k]).map((k) => k + "=" + Math.floor(mark[k]));
  return parts.length ? "[t3 " + parts.join(" ") + "]" : "";
}
const shelfOf = (th) => (th.mark.snoozed !== undefined ? "snoozed" : th.mark.settled !== undefined ? "settled" : "active");
const lastPrompt = (th) => Math.max(th.w.latestAt ? sec(th.w.latestAt) : 0, th.mark.last ?? 0);

// ── State ───────────────────────────────────────────────────────────────────

let clock = Math.floor(Date.now() / 1000);
const seconds = box(clock);
const minute = box(Math.floor(clock / 60));
// The open threads: workspace id -> thread. A thread is the workspace as cmux
// last reported it (`w`), its description taken apart (`user`, `block`,
// `mark`), and what the engine worked out (`state`, `status`, `since`). The
// engine reads and changes threads directly; rows subscribe to `ver`.
const threads = new Map();
let order = []; // their ids, in cmux's order
const revision = box(0); // bumps when a thread or the order changes
const projects = box({ labels: new Map(), home: null });
const selected = box("");
let selecting = null; // { id, at }: a click cmux hasn't shown yet
const pending = new Map(); // workspace id -> { text, at }: a description cmux hasn't shown yet
const agentsSeen = new Map(); // agent id -> { run: { start, seen }, at }
const woke = new Set(); // threads whose snooze ended by itself, until you look
const snoozedWhileWorking = new Set();
const wakeAnchor = new Map(); // snoozed thread id -> the open thread that followed it
let lastSweep = 0;
let lastMove = 0; // when we last pinned, moved, created or closed a workspace
let orderAsked = null;
const problem = box("");

// What the sidebar itself has to remember: favorite projects and the settled
// threads whose workspace is closed. It is kept as "[t3:…]" lines on a couple
// of workspaces (see persistShared), the highest `rev` being the current one.
const shared = { rev: 0, favorites: [], archive: [], block: "" };
const sharedVer = box(0); // bumps when it changes, or a record starts or ends closing or reopening
const archiveIndex = new Map(); // record id -> record
let openRecords = new Set(); // ids of records whose thread is open: its row stands in for them
const reopening = new Map(); // record id -> when we asked cmux for its workspace

const query = box("");
const searchGeneration = box(0);
const scope = box(null);
const picker = box(null); // "scope" | "new": the open project menu
const snoozeFor = box(null);
const customFor = box(null);
const editing = box(null); // the row being renamed
const settledShown = box(SETTLED_PAGE);
const snoozedOpen = box(false);
const settledOpen = box(false);
const notice = box(null);
const multi = new Set();
const multiVer = box(0);
let lastClicked = null;

const bump = () => revision.set(revision.peek() + 1);
const bumpShared = () => sharedVer.set(sharedVer.peek() + 1);
function touch(th) {
  th.setVer(++th.n);
  bump();
}
const isHome = (dir) => !!dir && dir === projects.peek().home;
// The home folder isn't a project: threads there are "No project".
const projectName = (dir, p) => (dir && dir === p.home ? NO_PROJECT : p.labels.get(dir) ?? baseName(dir));

// ── Descriptions ────────────────────────────────────────────────────────────

function readDescription(th, text) {
  th.text = text;
  Object.assign(th, parseDescription(text));
  adoptShared(th.block);
  touch(th);
}
// Writes what the thread now is. cmux applies it a moment later: until its
// data shows the same text, ours stands (see mirror).
function save(th) {
  const slept = th.mark.settled !== undefined ? th.slept : "";
  const text = [th.user, slept, th.block, formatMark(th.mark)].filter(Boolean).join("\n");
  if (text === th.text) return;
  th.text = text;
  pending.set(th.id, { text, at: clock });
  if (text.trim()) cmux("workspace.action", { action: "set_description", workspace_id: th.id, description: text });
  else cmux("workspace.action", { action: "clear_description", workspace_id: th.id });
}
function setMark(th, mark) {
  const from = th.mark.from;
  th.mark = mark;
  save(th);
  touch(th);
  if (from && mark.from !== from) forget(["a:" + from]); // no longer the settled thread that record is
}

// ── Shared state ────────────────────────────────────────────────────────────

// A settled record: { id, at, last, dir, title, s, pr? }. `s` lists the agent
// sessions to resume, one per pane: a Claude session id, "codex:<id>", or "?"
// for a Claude whose session cmux never told us. `pr` is [number, status, url].
let lastRecordId = 0;
const newRecordId = () => (lastRecordId = Math.max(lastRecordId + 1, clock * 1000));
function serializeShared() {
  if (!shared.favorites.length && !shared.archive.length) return "";
  const lines = ["[t3:rev " + shared.rev + "]"];
  for (const dir of shared.favorites) lines.push("[t3:fav " + dir + "]");
  for (const r of shared.archive) {
    const { id, at, last, dir, title, s, pr } = r;
    lines.push("[t3:arc " + JSON.stringify({ id, at, last, dir, title, s, pr }) + "]");
  }
  return lines.join("\n");
}
function parseShared(block) {
  const out = { rev: 0, favorites: [], archive: [] };
  for (const line of block.split("\n")) {
    const body = line.slice(8, -1);
    if (line.startsWith("[t3:rev ")) out.rev = +body || 0;
    else if (line.startsWith("[t3:fav ")) out.favorites.push(body);
    else if (line.startsWith("[t3:arc ")) {
      try {
        const r = JSON.parse(body);
        if (r && r.id > 0 && Array.isArray(r.s) && typeof r.title === "string") out.archive.push(r);
      } catch (_) {
        // a damaged line loses one record, not the rest
      }
    }
  }
  return out;
}
function setShared(next) {
  Object.assign(shared, next);
  shared.archive.sort((a, b) => b.at - a.at);
  if (MAX_SETTLED_THREADS != null) shared.archive.length = Math.min(shared.archive.length, MAX_SETTLED_THREADS);
  archiveIndex.clear();
  for (const r of shared.archive) {
    archiveIndex.set(String(r.id), r);
    lastRecordId = Math.max(lastRecordId, r.id);
  }
  shared.block = serializeShared();
  bumpShared();
}
function changeShared(change) {
  change();
  setShared({ rev: Math.max(shared.rev + 1, clock) });
  persistShared();
}
// Another copy is newer when its `rev` is higher (a tie goes to the larger
// text, so two sidebars always agree). Favorites saved before there was a
// `rev` are merged in.
function adoptShared(block) {
  if (!block || block === shared.block) return;
  const theirs = parseShared(block);
  if (theirs.rev > shared.rev || (theirs.rev === shared.rev && theirs.rev > 0 && block > shared.block)) {
    setShared(theirs);
  } else if (theirs.rev === 0) {
    // Written once every workspace is read (see step).
    const added = theirs.favorites.filter((d) => !shared.favorites.includes(d));
    if (added.length) setShared({ rev: Math.max(shared.rev + 1, clock), favorites: [...shared.favorites, ...added].sort() });
  }
}
// The shared lines live on CARRIERS workspaces, so closing one never loses
// them: the ones that already have them, else the least likely to close.
function persistShared() {
  const open = Array.from(threads.values()).filter((th) => !th.closing);
  const rank = (th) => (shelfOf(th) === "settled" ? 2 : 0) + (th.block ? 0 : 1);
  const carriers = shared.block ? open.slice().sort((a, b) => rank(a) - rank(b)).slice(0, CARRIERS) : [];
  for (const th of open) {
    const block = carriers.includes(th) ? shared.block : "";
    if (th.block !== block) {
      th.block = block;
      save(th);
    }
  }
}
function toggleFavorite(dir) {
  changeShared(() => {
    shared.favorites = shared.favorites.includes(dir) ? shared.favorites.filter((d) => d !== dir) : [...shared.favorites, dir].sort();
  });
}

// ── Agents ──────────────────────────────────────────────────────────────────

const isClaude = (a) => /claude/i.test(a.kind ?? "");
const isCodex = (a) => /codex/i.test(a.kind ?? "");
const liveAgents = (w) => (w.agents ?? []).filter((a) => a.status !== "ended");
// Claude Code puts its state in the terminal title: a spinner while a turn
// runs, ✳ otherwise. cmux learns that a turn ended from the Stop hook, which
// Claude Code skips when you interrupt it, so cmux says "working" until your
// next prompt. While the agent's tab still shows Claude's own title, its ✳ wins.
const CLAUDE_IDLE_TITLE = /^✳(\s|$)/;
const CLAUDE_TITLE = /^[\u2722-\u273D\u25D0-\u25D3]/;
function isWorking(w, a) {
  if (a.status !== "working") return false;
  if (!isClaude(a)) return true;
  const tab = a.panelId && (w.tabs ?? []).find((t) => t.id === a.panelId);
  return !(tab && CLAUDE_IDLE_TITLE.test(tab.title ?? ""));
}
// cmux knows when Claude is idle with a monitor or background command still
// running, but doesn't tell sidebars. claude-turn-end.sh puts it in the
// workspace's progress label: "Background: 1 monitor, 2 shells — <what>".
// cmux keeps progress across restarts, and can keep listing a Claude that's
// gone (idle, without a pid), so it only counts while one with a pid runs.
const BACKGROUND_LABEL = /^Background: (.+?)(?: — .*)?$/;
function backgroundWork(w) {
  const m = BACKGROUND_LABEL.exec(w.progress?.label ?? "");
  if (!m || !liveAgents(w).some((a) => isClaude(a) && a.pid)) return null;
  return /\bmonitors?\b/.test(m[1]) ? "monitoring" : "background";
}
// cmux restarts an agent's clock on every prompt, also one that steers a
// running turn, so "Working" counts from the start of the unbroken run. A gap
// of a few seconds is the same run: a queued message starts right after a Stop.
const STEER_GAP = 3;
function observe(th, t) {
  let input = false;
  let since = 0;
  for (const a of th.w.agents ?? []) {
    const seen = agentsSeen.get(a.id) ?? {};
    if (a.status === "needs_input") input = true;
    if (isWorking(th.w, a)) {
      const start = seen.run && t - seen.run.seen <= STEER_GAP ? seen.run.start : sec(a.sinceEpoch ?? a.lastActivityAt ?? t);
      seen.run = { start, seen: t };
      since = since || start;
    }
    seen.at = t;
    agentsSeen.set(a.id, seen);
  }
  th.state = input ? "input" : since ? "working" : null;
  th.since = since;
}
// What the row shows: the first of these that holds.
function showStatus(th) {
  const status = th.state ?? (woke.has(th.id) ? "woke" : backgroundWork(th.w) ?? ((th.w.unread ?? 0) > 0 ? "done" : null));
  const shown = status + ":" + th.since;
  if (shown === th.shown) return;
  th.shown = shown;
  th.status = status;
  touch(th);
}
// Nothing the thread would lose by closing: no turn, request or background
// task running, and no subagent.
const isQuiet = (th) => th.state === null && !backgroundWork(th.w) && !(th.w.agents ?? []).some((a) => (a.children ?? []).some((c) => c.running));
function agentKind(w) {
  const a = liveAgents(w)[0];
  if (!a) return "";
  return isClaude(a) ? "claude" : isCodex(a) ? "codex" : "other";
}
// The sessions a closed thread reopens with: each pane's latest Claude or
// Codex one, in tab order, plus those written by the version that put settled
// threads to sleep. null when the thread runs an agent we can't resume.
function sessionsOf(th) {
  const w = th.w;
  if (liveAgents(w).some((a) => !isClaude(a) && !isCodex(a))) return null;
  const tabs = (w.tabs ?? []).map((t) => t.id);
  const byPanel = new Map();
  for (const a of w.agents ?? []) {
    if ((isClaude(a) || isCodex(a)) && /^[\w-]+$/.test(a.id ?? "") && !byPanel.has(a.panelId ?? "")) byPanel.set(a.panelId ?? "", a);
  }
  const position = (panel) => (tabs.indexOf(panel) + 1 || tabs.length + 1);
  const out = Array.from(byPanel.entries())
    .sort((x, y) => position(x[0]) - position(y[0]))
    .map(([, a]) => (isCodex(a) ? "codex:" + a.id : a.id));
  for (const line of th.slept ? th.slept.split("\n") : []) {
    const id = SLEPT_LINE.exec(line)[1];
    if (/^[\w-]+$/.test(id) && !out.includes(id)) out.push(id);
  }
  // A Claude that cmux doesn't list still shows in its tab's title.
  if (!out.length && (th.mark.slept || (w.tabs ?? []).some((t) => CLAUDE_TITLE.test(t.title ?? "")))) out.push("?");
  return out;
}

// ── Titles ──────────────────────────────────────────────────────────────────

// Claude Code and Codex put a spinner and a generic name ("✳ Claude Code") in
// the terminal title; a real title there (a topic, your own rename) wins.
const TITLE_GLYPHS = /^[\s\u2722-\u273D\u00B7*\u2800-\u28FF\u2022\u25CF\u25D0-\u25D3\u23FA]+/u;
const GENERIC_TITLE = /^(claude( code)?|codex|openai codex|zsh|bash|fish|sh|login|~|~?\/.*)$/i;
const SHELL_TITLE = /^\S+@\S+:/;
function threadTitle(w) {
  const raw = String(w.title ?? "").replace(TITLE_GLYPHS, "").trim();
  const agents = w.agents ?? [];
  if (!agents.length) return raw || w.title || "";
  if (raw && !GENERIC_TITLE.test(raw) && !SHELL_TITLE.test(raw)) return raw;
  const convo = agents.find((a) => a.title)?.title ?? w.latestPrompt ?? "";
  const line = String(convo).split("\n").map((x) => x.trim()).find(Boolean) ?? "";
  return line ? (line.length > 120 ? line.slice(0, 119) + "…" : line) : raw || (agents[0].name ?? "New thread");
}

// ── Actions ─────────────────────────────────────────────────────────────────

function notify(text, options = {}) {
  notice.set({ text, at: clock, icon: options.undo ? "checkmark.circle" : "exclamationmark.circle", ...options });
}
function closeMenus() {
  picker.set(null);
  snoozeFor.set(null);
  customFor.set(null);
}
function selectWorkspace(id) {
  if (!threads.has(id)) return;
  selecting = { id, at: clock };
  selected.set(id);
  cmux("workspace.select", { workspace_id: id });
}
const shellQuote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
// cmux reads a title of digits only as a number and drops it.
const asTitle = (title) => (/^\d+$/.test(title) ? title + " " : title);
// The sidebar can't see the window's size, so the new terminal checks it and
// splits itself. The leading space keeps the line out of shell history where
// that is set up (zsh's hist_ignore_space).
function newThread(dir) {
  const params = { focus: "true" };
  if (dir) params.working_directory = dir;
  const command = NEW_THREAD_COMMAND && !isHome(dir) && dir !== "~" ? NEW_THREAD_COMMAND : "";
  if (SPLIT_NEW_THREAD_RATIO != null) {
    const wide = `cmux resize-window --window "$(cmux current-window)" | awk '{exit $2 < ${SPLIT_NEW_THREAD_RATIO} * $3}'`;
    const split = "cmux new-split right --focus false" + (command ? " --command " + shellQuote(command) : "") + " >/dev/null";
    params.initial_input = ` ${wide} && ${split}; clear` + (command ? "; " + command : "") + "\r";
  } else if (command) {
    params.initial_input = command + "\r";
  }
  lastMove = clock;
  cmux("workspace.create", params);
}

const cardIds = () => cards().filter((e) => e.kind === "card").map((e) => e.id);
function anchorForRemoval(ids) {
  const all = cardIds();
  const first = all.findIndex((id) => ids.includes(id));
  if (first < 0) return undefined;
  return { before: all.slice(first + 1).find((id) => !ids.includes(id)) ?? null };
}
// Settling or snoozing the open thread moves on to the next one, or to a fresh
// "No project" thread when none is left.
function moveSelectionAway(ids) {
  const open = selected.peek();
  if (!ids.includes(open)) return;
  const all = cardIds();
  const start = all.indexOf(open);
  for (let i = 1; i <= all.length; i++) {
    const next = all[(start + i) % all.length];
    if (next && !ids.includes(next)) return selectWorkspace(next);
  }
  newThread(projects.peek().home ?? "~");
}
function pin(th, on) {
  lastMove = clock;
  cmux("workspace.action", { action: on ? "pin" : "unpin", workspace_id: th.id });
}
function settle(ids, auto) {
  const ok = ids.map((id) => threads.get(id)).filter((th) => th && !th.closing && th.state === null && shelfOf(th) !== "settled");
  if (!ok.length) {
    if (!auto) notify("Can't settle: thread has active work", { anchor: { after: ids[0] } });
    return;
  }
  const okIds = ok.map((th) => th.id);
  const anchor = auto ? undefined : anchorForRemoval(okIds);
  const before = new Map(ok.map((th) => [th.id, th.mark]));
  const pinned = ok.filter((th) => th.w.pinned).map((th) => th.id);
  if (!auto) moveSelectionAway(okIds);
  for (const th of ok) {
    if (th.w.pinned) pin(th, false);
    woke.delete(th.id);
    th.lastOpen = 0; // you're done with it: no grace before it closes,
    th.leaving = true; // nor for the moment cmux still has it open
    setMark(th, { settled: clock, last: lastPrompt(th) });
  }
  if (auto) return;
  // Settling more while the notice is still up adds to it: one Undo for all.
  const prev = notice.peek();
  const batch = prev?.settled && clock - prev.at < NOTICE_SECONDS ? prev.settled : { ids: [], before: new Map(), pinned: [] };
  const all = { ids: [...batch.ids, ...okIds], before: new Map([...batch.before, ...before]), pinned: [...batch.pinned, ...pinned] };
  notify("Settled " + all.ids.length + " thread" + (all.ids.length === 1 ? "" : "s"), {
    anchor,
    settled: all,
    undo() {
      restoreMarks(all.before);
      for (const id of all.pinned) if (threads.has(id)) pin(threads.get(id), true);
    },
  });
}
function restoreMarks(before) {
  for (const [id, mark] of before) if (threads.has(id)) setMark(threads.get(id), mark);
}
// manual = you did it (un-settle, pin): auto-settle then leaves it alone.
function toActive(th, manual) {
  setMark(th, manual ? { manual: 1, last: lastPrompt(th) } : { last: lastPrompt(th) });
}
function moveTop(th) {
  lastMove = clock;
  cmux("workspace.action", { action: "move_top", workspace_id: th.id });
}
function snooze(ids, until) {
  const ok = ids.map((id) => threads.get(id)).filter((th) => th && !th.closing && th.state !== "input");
  closeMenus();
  if (!ok.length || !(until > clock)) return;
  const okIds = ok.map((th) => th.id);
  const anchor = anchorForRemoval(okIds);
  const all = cardIds();
  const before = new Map(ok.map((th) => [th.id, th.mark]));
  moveSelectionAway(okIds);
  for (const th of ok) {
    const after = all.slice(all.indexOf(th.id) + 1).find((id) => !okIds.includes(id));
    if (after) wakeAnchor.set(th.id, after);
    else wakeAnchor.delete(th.id);
    woke.delete(th.id);
    if (th.state === "working") snoozedWhileWorking.add(th.id);
    setMark(th, { snoozed: until, at: clock, last: lastPrompt(th) });
  }
  notify("Snoozed until " + dayTime(until, clock), { anchor, icon: "clock", undo: () => restoreMarks(before) });
}
// Back among the open threads, where it was: before the thread that followed it.
function wake(ids, automatic) {
  for (const id of ids) {
    const th = threads.get(id);
    if (!th) continue;
    toActive(th, false);
    snoozedWhileWorking.delete(id);
    if (automatic) woke.add(id);
    const anchor = threads.get(wakeAnchor.get(id));
    wakeAnchor.delete(id);
    const from = order.indexOf(id);
    const before = anchor && shelfOf(anchor) === "active" ? order.indexOf(anchor.id) : -1;
    lastMove = clock;
    if (before >= 0) cmux("workspace.reorder", { workspace_id: id, index: from < before ? before - 1 : before });
    else moveTop(th);
  }
}
function dismissWoke(id) {
  if (woke.delete(id) && threads.has(id)) showStatus(threads.get(id));
}

// A row is named by its workspace id, or "a:<record id>" once that's closed.
const recordOf = (ref) => (ref.startsWith("a:") ? archiveIndex.get(ref.slice(2)) : undefined);
const bulk = (ref) => (multi.has(ref) ? Array.from(multi) : [ref]);
function clearMulti() {
  if (!multi.size) return;
  multi.clear();
  multiVer.set(multiVer.peek() + 1);
}
function unsettle(refs) {
  const live = refs.map((ref) => threads.get(ref)).filter(Boolean);
  for (const th of live) toActive(th, true);
  for (const th of live.slice().reverse()) moveTop(th);
  for (const ref of refs) if (recordOf(ref)) reopen(recordOf(ref), true);
}

// ── Closing and reopening settled threads ───────────────────────────────────

// Closes a settled thread's workspace and keeps a record to reopen it from: its
// own one again if it was reopened from one, which also keeps the sessions of
// a thread that closes before cmux has listed its agents. Force, because cmux
// counts an idle agent as a running process: a thread without an agent closes
// only if nothing runs in it.
function archive(th, sessions) {
  const w = th.w;
  const was = archiveIndex.get(String(th.mark.from));
  const record = { id: was?.id ?? newRecordId(), at: th.mark.settled, last: lastPrompt(th), dir: w.directory ?? "", title: threadTitle(w), s: sessions.length ? sessions : was?.s ?? [] };
  if (w.pr) record.pr = [w.pr.number, w.pr.status, w.pr.url];
  else if (was?.pr) record.pr = was.pr;
  th.closing = clock;
  th.record = record.id;
  changeShared(() => (shared.archive = [record, ...shared.archive.filter((r) => r !== was)])); // on other workspaces before this one goes
  hideOpenRecords();
  lastMove = clock;
  cmux("workspace.close", { workspace_id: th.id, force: String(liveAgents(w).length > 0) });
}
// A record's row is its thread's while that is open or on its way out.
function hideOpenRecords() {
  const ids = new Set();
  for (const th of threads.values()) {
    if (th.mark.from) ids.add(th.mark.from);
    if (th.closing) ids.add(th.record);
  }
  if (ids.size === openRecords.size && Array.from(ids).every((id) => openRecords.has(id))) return;
  openRecords = ids;
  bumpShared();
}
const RESUME_SCRIPT = "~/.config/cmux/claude-turn-end.sh";
function resumeCommand(session) {
  if (session.startsWith("codex:")) return "codex resume " + session.slice(6);
  if (session === "?") return "claude --resume"; // Claude Code's own picker
  // claude-turn-end.sh kept the flags the session ran with.
  return `if [ -x ${RESUME_SCRIPT} ]; then ${RESUME_SCRIPT} resume ${session}; else claude --resume ${session}; fi`;
}
// A new workspace in the record's folder, its first terminal resuming the
// first session and a split for each other one. Its marker's `from` names the
// record, which stays until the thread is un-settled: closing the workspace,
// by the sidebar or by hand, makes it a settled row again.
function reopen(record, activate) {
  if (reopening.has(record.id)) return;
  reopening.set(record.id, clock);
  const mark = activate ? { manual: 1, last: record.last, from: record.id, top: 1 } : { settled: record.at, last: record.last, from: record.id };
  const params = { title: asTitle(record.title), description: formatMark(mark), focus: String(!activate) };
  if (record.dir) params.working_directory = record.dir;
  const [first, ...rest] = record.s.map(resumeCommand);
  if (first) {
    const splits = rest.map((c) => "cmux new-split right --focus false --command " + shellQuote(c) + " >/dev/null; ").join("");
    params.initial_input = " " + splits + "clear; " + first + "\r";
  }
  lastMove = clock;
  cmux("workspace.create", params);
  bumpShared();
}
function forget(refs) {
  const gone = refs.map(recordOf).filter(Boolean);
  if (gone.length) changeShared(() => (shared.archive = shared.archive.filter((r) => !gone.includes(r))));
}
function closeThreads(refs) {
  for (const ref of refs) {
    const th = threads.get(ref);
    if (!th) continue;
    if (!isQuiet(th)) {
      notify("Can't close: thread has active work", { anchor: { after: th.id } });
      continue;
    }
    if (th.w.pinned) pin(th, false);
    if (th.mark.from) forget(["a:" + th.mark.from]);
    lastMove = clock;
    cmux("workspace.close", { workspace_id: th.id, force: "true" });
  }
  forget(refs);
}

// ── Engine ──────────────────────────────────────────────────────────────────

let mirrored = null;
let settledVersion = null;
function step(t, list, open) {
  clock = t;
  seconds.set(t);
  minute.set(Math.floor(t / 60));
  mirror(list, open);
  for (const th of threads.values()) {
    observe(th, t);
    if (!th.closing) advance(th, t);
    showStatus(th);
  }
  for (const [id, seen] of agentsSeen) if (t - seen.at > 60) agentsSeen.delete(id);
  if (t - lastSweep >= 60) {
    lastSweep = t;
    autoSettle(t);
  }
  if (CLOSE_SETTLED) closeSettled(t);
  hideOpenRecords();
  const version = revision.peek() + ":" + sharedVer.peek();
  if (version !== settledVersion) {
    dropResumed();
    indexProjects();
    settledVersion = revision.peek() + ":" + sharedVer.peek();
  }
  checkReopening(t);
  persistShared();
  syncOrder(t);
  const n = notice.peek();
  if (n && t - n.at >= NOTICE_SECONDS) notice.set(null);
}

// Takes in cmux's workspace list. A thread's `w` is replaced only when cmux
// changed it, so rows of threads that didn't change aren't touched.
function mirror(list, open) {
  if (list !== mirrored) {
    mirrored = list;
    const seen = new Set();
    for (const w of list) {
      seen.add(w.id);
      let th = threads.get(w.id);
      if (!th) {
        const [ver, setVer] = signal(0);
        th = { id: w.id, w, json: "", text: null, user: "", block: "", slept: "", mark: {}, state: undefined, status: null, since: 0, seen: clock, n: 0, ver, setVer };
        threads.set(w.id, th);
      }
      // The description is compared by itself: the shared lines make it long.
      const { description: theirs = "", ...rest } = w;
      const json = JSON.stringify(rest);
      if (json !== th.json) {
        th.json = json;
        th.w = w;
        touch(th);
      }
      if (pending.get(w.id)?.text === theirs) pending.delete(w.id);
      if (!pending.has(w.id) && theirs !== th.text) readDescription(th, theirs);
    }
    for (const [id, th] of threads) {
      if (seen.has(id)) continue;
      threads.delete(id);
      for (const set of [pending, woke, snoozedWhileWorking, wakeAnchor, multi]) set.delete(id);
    }
    const ids = list.map((w) => w.id);
    if (ids.join() !== order.join()) order = ids;
    bump();
  }
  // A description cmux never showed: take its word again.
  for (const [id, p] of pending) {
    if (clock - p.at <= ECHO_SECONDS) continue;
    pending.delete(id);
    const th = threads.get(id);
    if (th) readDescription(th, th.w.description ?? "");
  }
  let now = open || (list.find((w) => w.selected)?.id ?? "");
  if (selecting) {
    if (now === selecting.id || clock - selecting.at > 2 || !threads.has(selecting.id)) selecting = null;
    else now = selecting.id;
  }
  if (now !== selected.peek()) selected.set(now);
}

// What a thread does by itself.
function advance(th, t) {
  const mark = th.mark;
  const state = th.state;
  const prev = th.prev;
  th.prev = state;
  const prompt = th.w.latestAt ? sec(th.w.latestAt) : 0;
  if (th.id !== selected.peek()) th.leaving = false;
  else if (!th.leaving) th.lastOpen = t;
  if (mark.from && reopening.delete(mark.from)) bumpShared();
  if (mark.top) {
    // Un-settled from its record: among the open threads, on top.
    const { from, top, ...rest } = mark;
    moveTop(th);
    return setMark(th, rest);
  }
  if (mark.snoozed !== undefined) {
    // Wakes on its timer, on a request for input, or when a run ends that was
    // going when you snoozed it or that you started since.
    const changed = prev !== undefined && prev !== state;
    const ownRun = snoozedWhileWorking.has(th.id) || (mark.at && prompt > mark.at);
    if (t >= mark.snoozed || (changed && state === "input") || (changed && prev === "working" && state === null && ownRun)) return wake([th.id], true);
  } else if (mark.settled !== undefined) {
    // Only a prompt you sent since brings it back: agent state alone doesn't,
    // cmux restores sessions when it restarts.
    if (prompt > mark.settled) {
      toActive(th, false);
      return moveTop(th);
    }
  } else if (state === "working" && prev !== undefined && prev !== "working" && woke.has(th.id)) {
    dismissWoke(th.id);
  }
  if (prompt > (mark.last ?? 0) + 1) setMark(th, { ...mark, last: prompt });
}
function autoSettle(t) {
  const due = [];
  for (const th of threads.values()) {
    if (th.closing || shelfOf(th) !== "active" || th.w.pinned || th.id === selected.peek() || th.mark.manual) continue;
    // Background work too: a merged PR's thread can still be watching the deploy.
    if (th.state !== null || backgroundWork(th.w)) continue;
    const pr = th.w.pr;
    const last = lastPrompt(th);
    const merged = pr && (pr.status === "closed" || (AUTO_SETTLE_ON_MERGE && pr.status === "merged"));
    if (merged || (AUTO_SETTLE_AFTER_DAYS != null && last > 0 && t - last >= AUTO_SETTLE_AFTER_DAYS * 86400)) due.push(th.id);
  }
  if (due.length) settle(due, true);
}
// A settled thread's workspace closes once its Undo is gone, or OPEN_GRACE
// after you last had it open. Never the only workspace left (cmux would close
// the window), one with work still going or listening on a port, or one this
// sidebar has only just seen (a reopened thread isn't shown as open at once).
// One at a time, so a pile of them doesn't stall cmux.
function closeSettled(t) {
  for (const th of threads.values()) {
    if (th.closing) {
      // Still there: cmux refused (something else runs in it). Ask again later.
      if (t - th.closing < 5) continue;
      th.closing = 0;
      th.retry = t + OPEN_GRACE;
      if (!th.mark.from) forget(["a:" + th.record]);
    }
    if (shelfOf(th) !== "settled" || th.id === selected.peek() || t < (th.retry ?? 0)) continue;
    if (t - th.mark.settled < NOTICE_SECONDS + 5 || t - (th.lastOpen ?? 0) < OPEN_GRACE || t - th.seen < NOTICE_SECONDS + 5) continue;
    if (!isQuiet(th) || (th.w.ports ?? []).length || pending.has(th.id)) continue;
    if (!Array.from(threads.values()).some((other) => other !== th && !other.closing)) continue;
    const sessions = sessionsOf(th);
    if (sessions) return archive(th, sessions);
  }
}
// A record whose session runs in an open thread again (you resumed it
// yourself) is that thread now.
function dropResumed() {
  if (!shared.archive.length) return;
  const running = new Set();
  for (const th of threads.values()) if (!th.closing) for (const a of th.w.agents ?? []) running.add(isCodex(a) ? "codex:" + a.id : a.id);
  const resumed = shared.archive.filter((r) => !openRecords.has(r.id) && r.s.some((s) => running.has(s)));
  if (resumed.length) changeShared(() => (shared.archive = shared.archive.filter((r) => !resumed.includes(r))));
}
// A record whose workspace never came (its folder is gone, say) is a settled
// row again.
function checkReopening(t) {
  for (const [id, at] of reopening) {
    const record = archiveIndex.get(String(id));
    if (record && t - at < ECHO_SECONDS) continue;
    reopening.delete(id);
    bumpShared();
    if (record) notify("Couldn't reopen “" + record.title + "”");
  }
}
// Cmd+1…9 follow cmux's workspace order, so it's kept the same as the
// sidebar's: open threads, then snoozed, then settled. cmux keeps pinned
// workspaces first. Asked once per order: if cmux won't take it, don't fight.
const SHELF_RANK = { active: 0, snoozed: 1, settled: 2 };
function syncOrder(t) {
  if (pending.size || t - lastMove < 2) return; // cmux hasn't shown our own changes yet
  const rows = order.map((id, i) => {
    const th = threads.get(id);
    const shelf = shelfOf(th);
    const key = shelf === "snoozed" ? th.mark.snoozed : shelf === "settled" ? -th.mark.settled : 0;
    return { id, rank: (th.w.pinned ? 0 : 3) + SHELF_RANK[shelf], key, i };
  });
  const want = rows.slice().sort((a, b) => a.rank - b.rank || a.key - b.key || a.i - b.i).map((r) => r.id);
  const key = want.join();
  if (key === order.join()) orderAsked = null;
  else if (orderAsked !== key) {
    orderAsked = key;
    cmux("workspace.reorder_many", { workspace_ids: JSON.stringify(want) });
  }
}
let projectsKey = null;
function indexProjects() {
  const dirs = new Set(shared.favorites);
  for (const th of threads.values()) if (th.w.directory) dirs.add(th.w.directory);
  for (const r of shared.archive) if (r.dir) dirs.add(r.dir);
  const sorted = Array.from(dirs).sort((a, b) => a.localeCompare(b));
  const key = sorted.join("\n");
  if (key === projectsKey) return;
  projectsKey = key;
  const home = sorted.map((d) => /^\/Users\/[^/]+/.exec(d)?.[0]).find(Boolean) ?? null;
  projects.set({ labels: projectLabels(sorted.filter((d) => d !== home)), home });
}

// ── Lists ───────────────────────────────────────────────────────────────────

function matches(title, prs) {
  const q = query.get().trim().toLowerCase();
  if (!q) return true;
  if (title.toLowerCase().includes(q)) return true;
  const n = q.replace(/^#/, "");
  return /^\d+$/.test(n) && prs.some((number) => String(number).startsWith(n));
}
const inScope = (dir) => !scope.get() || dir === scope.get();
const shows = (th) => inScope(th.w.directory) && matches(threadTitle(th.w), (th.w.prs ?? (th.w.pr ? [th.w.pr] : [])).map((p) => p.number));
function liveRows(shelf) {
  revision.get();
  return order.map((id) => threads.get(id)).filter((th) => th && shelfOf(th) === shelf && shows(th));
}
const noticeLive = memo(() => {
  const n = notice.get();
  return !!n && seconds.get() - n.at < NOTICE_SECONDS;
});
// The open threads, pinned first, with the notice where you acted: where a
// settled or snoozed card was (`before`, null = the end), under a card
// (`after`), or else on top.
const cards = memo(() => {
  const rows = liveRows("active");
  const out = [];
  const live = noticeLive() ? notice.get() : null;
  const banner = live && { key: "n:" + live.at + ":" + live.text, kind: "notice" };
  let placed = false;
  const place = () => {
    if (banner && !placed) out.push(banner);
    placed = true;
  };
  for (const th of [...rows.filter((x) => x.w.pinned), ...rows.filter((x) => !x.w.pinned)]) {
    if (live?.anchor?.before === th.id) place();
    out.push(editing.get() === th.id ? { key: "e:" + th.id, kind: "edit", id: th.id, height: CARD_H } : { key: "c:" + th.id, kind: "card", id: th.id });
    if (live?.anchor?.after === th.id) place();
  }
  if (banner && !placed) {
    if (live.anchor && live.anchor.before === null) out.push(banner);
    else out.unshift(banner);
  }
  return out;
}, sameKeys);
const snoozed = memo(() => liveRows("snoozed").sort((a, b) => a.mark.snoozed - b.mark.snoozed).map((th) => ({ key: "z:" + th.id, kind: "snoozed", id: th.id })), sameKeys);
// Settled threads, newest first: the few whose workspace is still open, and
// the records of the rest. The records are only gone through when they, the
// search or the filter change.
const settledOpenRows = memo(() => liveRows("settled").map((th) => ({ key: "s:" + th.id, kind: "settled", id: th.id, at: th.mark.settled })), sameKeys);
const settledRecords = memo(() => {
  sharedVer.get();
  return shared.archive
    .filter((r) => !openRecords.has(r.id) && inScope(r.dir) && matches(r.title, r.pr ? [r.pr[0]] : []))
    .map((r) => ({ key: "a:" + r.id, kind: "archived", id: "a:" + r.id, at: r.at }));
}, sameKeys);
const settled = memo(() => [...settledOpenRows(), ...settledRecords()].sort((a, b) => b.at - a.at), sameKeys);
// A shelf shows a page of its rows when open, and the open thread always.
function shelfEntries(rows, isOpen, limit) {
  const shown = isOpen ? rows.slice(0, limit) : [];
  const open = rows.find((e) => e.id === selected.get());
  if (open && !shown.includes(open)) shown.push(open);
  return shown.map((e) => (editing.get() === e.id ? { key: "e:" + e.id, kind: "edit", id: e.id, height: SLIM_H } : e));
}
const snoozedEntries = memo(() => shelfEntries(snoozed(), snoozedOpen.get(), Infinity), sameKeys);
const settledEntries = memo(() => shelfEntries(settled(), settledOpen.get(), settledShown.get()), sameKeys);
const isEmpty = memo(() => cards().every((e) => e.kind === "notice") && !snoozed().length && !settled().length);

function setScope(dir) {
  scope.set(dir);
  settledShown.set(SETTLED_PAGE);
}
// Projects with an open thread; `keep` stays listed anyway (the filter's
// current project, so its checkmark doesn't vanish).
function activeProjects(keep) {
  const dirs = new Set([keep]);
  for (const th of threads.values()) if (!th.closing && shelfOf(th) === "active") dirs.add(th.w.directory);
  return Array.from(projects.peek().labels.keys()).filter((dir) => dirs.has(dir));
}
// The new-thread menu adds favorites, also ones without a thread, first.
function newThreadProjects() {
  const favorite = (dir) => shared.favorites.includes(dir);
  const dirs = new Set([...activeProjects(), ...shared.favorites.filter((dir) => !isHome(dir))]);
  return Array.from(dirs).sort((a, b) => favorite(b) - favorite(a) || a.localeCompare(b));
}

// ── Row actions ─────────────────────────────────────────────────────────────

function rowClick(ref, payload) {
  closeMenus();
  if (payload && payload.cmd) {
    if (!multi.delete(ref)) multi.add(ref);
    multiVer.set(multiVer.peek() + 1);
  } else if (payload && payload.shift && lastClicked) {
    const refs = [...cards(), ...snoozedEntries(), ...settledEntries()].filter((e) => e.kind !== "notice").map((e) => e.id);
    const a = refs.indexOf(lastClicked);
    const b = refs.indexOf(ref);
    if (a >= 0 && b >= 0) for (const x of refs.slice(Math.min(a, b), Math.max(a, b) + 1)) multi.add(x);
    multiVer.set(multiVer.peek() + 1);
  } else {
    clearMulti();
    if (recordOf(ref)) reopen(recordOf(ref), false);
    else selectWorkspace(ref);
  }
  lastClicked = ref;
}
function askSnooze(id) {
  customFor.set(null);
  picker.set(null);
  if (threads.get(id)?.state === "input") return notify("Can't snooze: thread is waiting for input", { anchor: { after: id } });
  snoozeFor.set(snoozeFor.peek() === id ? null : id);
}
function rename(ref, text) {
  const title = (text ?? "").trim();
  editing.set(null);
  if (!title) return;
  const record = recordOf(ref);
  if (record) changeShared(() => (record.title = title));
  else if (threads.has(ref)) cmux("workspace.action", { action: "rename", workspace_id: ref, title: asTitle(title) });
}
// Dropping a card among the pinned ones pins it, and the other way round.
function handleMove(key, index) {
  const id = key.slice(2);
  const th = threads.get(id);
  if (!th) return;
  const rest = cards().filter((e) => e.key !== key);
  const next = rest.slice(index).find((e) => e.kind === "card");
  const prev = rest.slice(0, index).reverse().find((e) => e.kind === "card");
  const isPinned = (e) => !!e && !!threads.get(e.id)?.w.pinned;
  if (!th.w.pinned && isPinned(next)) pin(th, true);
  if (th.w.pinned && prev && !isPinned(prev)) pin(th, false);
  const from = order.indexOf(id);
  lastMove = clock;
  if (next) {
    const before = order.indexOf(next.id);
    cmux("workspace.reorder", { workspace_id: id, index: from < before ? before - 1 : before });
  } else if (prev) {
    const after = order.indexOf(prev.id);
    cmux("workspace.reorder", { workspace_id: id, index: from < after ? after : after + 1 });
  }
}

// ── Views: parts ────────────────────────────────────────────────────────────

function ProjectBadge(dir) {
  const home = () => !!dir() && dir() === projects.get().home;
  return Text(() => (home() ? "⌂" : monogram(baseName(dir()))))
    .font(() => (home() ? 11 : 8))
    .weight("bold")
    .monospaced()
    .color(() => (home() ? "secondary" : projectColor(dir())))
    .frame({ width: 16, height: 16 })
    .background(() => (home() ? "#7f7f7f1f" : projectColor(dir()) + "24"))
    .cornerRadius(4);
}
function PinMark(pinned) {
  return Image("pin.fill").font(9).color(PALETTE.faint).frame({ width: () => (pinned() ? 10 : 0) }).opacity(() => (pinned() ? 1 : 0));
}
function PrBadge(v) {
  return HStack({ spacing: 3 }, [Image("arrow.triangle.pull").font(10), Text(() => (v.pr() ? String(v.pr()) : "")).font(12)])
    .color(() => PR_COLORS[v.prStatus()] ?? "secondary")
    .opacity(() => (v.pr() ? 1 : 0))
    .layoutPriority(2)
    .onTap(() => v.prUrl() && openURL(v.prUrl()));
}
// The sidebar can only draw SF Symbols and text, so these stand in for the
// logos: Claude Code's ✻ and a generic mark for Codex.
const AGENT_MARKS = { claude: "\u273B", codex: "\u269B\uFE0E", other: "\u2726" };
function AgentMark(kind) {
  return Text(() => AGENT_MARKS[kind()] ?? "")
    .font(() => (kind() === "claude" ? 13 : 12))
    .color(() => (kind() === "claude" ? "#D97757" : "secondary"))
    .opacity(() => (kind() === "claude" ? 1 : 0.6))
    .frame({ width: () => (kind() ? 14 : 0), height: 14 });
}
function HoverControl(node) {
  return node.color(PALETTE.muted).cornerRadius(5).hoverBackground(PALETTE.control);
}
function rowBackground(node, v, height) {
  return node
    .cornerRadius(6)
    .background(() => (v.multi() ? SELECTION : v.selected() ? PALETTE.rowActive : null))
    .hoverBackground(() => (v.multi() ? SELECTION : v.selected() ? PALETTE.rowActive : PALETTE.rowHover))
    .frame({ maxWidth: "infinity", height });
}
function threadMenu(ref, v) {
  const th = threads.get(ref);
  const dir = () => (th ? th.w.directory : recordOf(ref)?.dir) ?? null;
  const done = (run) => () => {
    run(bulk(ref));
    clearMulti();
  };
  const filter = Button(
    () => (scope.get() ? "Show all projects" : v.home() ? "Show only threads without a project" : "Filter by " + v.project()),
    () => setScope(scope.peek() ? null : dir()),
  );
  if (!th) {
    return [
      Button("New thread", () => newThread(dir())),
      Button("Un-settle thread", done(unsettle)),
      Divider(),
      Button("Rename thread", () => editing.set(ref)),
      filter,
      Divider(),
      Button("Delete thread", done(forget)).destructive(),
    ];
  }
  const live = (refs) => refs.map((x) => threads.get(x)).filter(Boolean);
  return [
    Button(() => (v.branch() ? "New thread on " + v.branch() : "New thread"), () => newThread(dir())),
    Button(() => (v.pinned() ? "Unpin thread" : "Pin thread"), done((refs) => {
      const on = !th.w.pinned;
      for (const x of live(refs)) {
        if (on && shelfOf(x) !== "active") toActive(x, true);
        pin(x, on);
      }
    })),
    Button(() => (v.shelf() === "settled" ? "Un-settle thread" : "Settle thread"), done((refs) => (shelfOf(th) === "settled" ? unsettle(refs) : settle(refs)))),
    Button(() => (v.shelf() === "snoozed" ? "Wake thread" : "Snooze…"), () => {
      if (shelfOf(th) !== "snoozed") return askSnooze(ref);
      wake(bulk(ref), false);
      clearMulti();
    }),
    Divider(),
    Button("Rename thread", () => editing.set(ref)),
    Button("Mark unread", () => cmux("workspace.action", { action: "mark_unread", workspace_id: ref })),
    filter,
    Divider(),
    Button("Close workspace", done(closeThreads)).destructive(),
  ];
}

// ── Views: rows ─────────────────────────────────────────────────────────────

function ThreadCard(id) {
  const th = threads.get(id);
  const v = fields(() => {
    th.ver();
    multiVer.get();
    const w = th.w;
    const p = projects.get();
    const isSelected = selected.get() === id;
    const isMulti = multi.has(id);
    const status = th.status;
    const quiet = status !== "input" && status !== "woke" && status !== "done";
    return {
      dir: w.directory ?? "",
      home: !!w.directory && w.directory === p.home,
      project: projectName(w.directory, p) || w.title || "",
      pinned: !!w.pinned,
      shelf: shelfOf(th),
      status: status ?? "",
      since: th.since,
      idle: status ? "" : relative(lastPrompt(th), minute.get() * 60),
      title: threadTitle(w),
      branch: w.branch ?? "",
      pr: w.pr?.number ?? 0,
      prStatus: w.pr?.status ?? "",
      prUrl: w.pr?.url ?? "",
      remote: !!w.remote,
      agent: agentKind(w),
      selected: isSelected,
      multi: isMulti,
      // Threads with nothing new step back; working ones are dimmed as well.
      receded: !isSelected && !isMulti && quiet && (status === "working" || !((w.unread ?? 0) > 0)),
      dimmed: status === "working" && !isSelected && !isMulti,
    };
  });
  const dim = () => (v.dimmed() ? 0.7 : 1);
  const weight = () => (v.receded() ? "regular" : "medium");
  const look = () => STATUS[v.status()];
  return rowBackground(
    VStack({ spacing: 0, alignment: "leading" }, [
      // cmux splits leftover width between flexible views: the status never
      // shrinks, the project label comes next, the spacer last.
      HStack({ spacing: 6 }, [
        HStack({ spacing: 6 }, [
          ProjectBadge(v.dir),
          Text(v.project).font(12).weight(weight).color(PALETTE.muted).lineLimit(1).truncation("tail"),
          PinMark(v.pinned),
        ]).opacity(dim).layoutPriority(1),
        Spacer({ minLength: 4 }),
        ZStack({ alignment: "trailing" }, [
          HStack({ spacing: 4 }, [
            Image(() => look()?.icon ?? "circle").font(12).color(() => look()?.color ?? "clear").frame({ width: () => (look() ? 16 : 0) }),
            Text(() => (v.status() === "working" ? "Working " + duration(seconds.get() - v.since()) : look()?.text ?? v.idle()))
              .font(12)
              .weight(() => (look() ? "medium" : "regular"))
              .color(() => look()?.color ?? PALETTE.muted),
          ]).opacity(dim).hideOnHover(),
          HStack({ spacing: 8 }, [
            Text("Woke").font(12).weight("medium").color(WARNING)
              .frame({ width: () => (v.status() === "woke" ? undefined : 0) })
              .opacity(() => (v.status() === "woke" ? 1 : 0))
              .onTap(() => dismissWoke(id)),
            HoverControl(Image("clock").font(11).padding(3)).onTap(() => askSnooze(id)),
            HoverControl(Text("✓ Settle").font(12).lineLimit(1).paddingHorizontal(4).paddingVertical(2)).onTap(() => settle(bulk(id))),
          ]).showOnHover(),
        ]).layoutPriority(2),
      ]).frame({ height: 20 }),
      Text(v.title).font(14).weight(weight).color(() => (v.receded() ? PALETTE.muted : PALETTE.fg)).lineLimit(1).truncation("tail").marquee().opacity(dim).paddingTop(4),
      HStack({ spacing: 6 }, [
        Text(v.branch).font(12).color(PALETTE.faint).lineLimit(1).truncation("middle"),
        PrBadge(v),
        Spacer({ minLength: 0 }),
        Image("server.rack").font(11).color(PALETTE.faint).opacity(() => (v.remote() ? 1 : 0)),
        AgentMark(v.agent),
      ]).frame({ maxWidth: "infinity" }).opacity(dim).paddingTop(2),
    ]).paddingHorizontal(10).paddingVertical(8),
    v,
    CARD_H,
  )
    .onTap((payload) => rowClick(id, payload))
    .onDoubleTap(() => editing.set(id))
    .contextMenu(threadMenu(id, v));
}

// A snoozed or settled thread: one line. `ref` is a workspace id, or a record.
function ShelfRow(kind, ref) {
  const th = threads.get(ref);
  const v = fields(() => {
    multiVer.get();
    const p = projects.get();
    const now = minute.get() * 60;
    const common = { selected: selected.get() === ref, multi: multi.has(ref) };
    if (th) {
      th.ver();
      const w = th.w;
      return {
        ...common,
        dir: w.directory ?? "",
        home: !!w.directory && w.directory === p.home,
        project: projectName(w.directory, p),
        title: threadTitle(w),
        branch: w.branch ?? "",
        pinned: !!w.pinned,
        shelf: shelfOf(th),
        pr: w.pr?.number ?? 0,
        prStatus: w.pr?.status ?? "",
        prUrl: w.pr?.url ?? "",
        when: th.mark.snoozed !== undefined ? countdown(th.mark.snoozed, now) : relative(th.mark.settled || lastPrompt(th), now),
      };
    }
    sharedVer.get();
    const r = recordOf(ref) ?? { dir: "", title: "", at: 0 };
    return {
      ...common,
      selected: reopening.has(r.id),
      dir: r.dir,
      home: !!r.dir && r.dir === p.home,
      project: projectName(r.dir, p),
      title: r.title,
      branch: "",
      pinned: false,
      shelf: "settled",
      pr: r.pr?.[0] ?? 0,
      prStatus: r.pr?.[1] ?? "",
      prUrl: r.pr?.[2] ?? "",
      when: relative(r.at, now),
    };
  });
  const isSnoozed = kind === "snoozed";
  const row = rowBackground(
    HStack({ spacing: 10 }, [
      ProjectBadge(v.dir).opacity(0.4),
      Text(v.title).font(14).color(() => (v.selected() ? PALETTE.fg : PALETTE.faint)).lineLimit(1).truncation("tail").marquee(),
      PinMark(v.pinned),
      PrBadge(v),
      Spacer({ minLength: 0 }),
      ZStack({ alignment: "trailing" }, [
        Text(v.when).font(12).color(isSnoozed ? INFO : PALETTE.faint).hideOnHover(),
        HoverControl(Image(isSnoozed ? "alarm" : "arrow.uturn.backward").font(11).padding(3))
          .showOnHover()
          .onTap(() => (isSnoozed ? wake([ref], false) : unsettle([ref]))),
      ]).frame({ minWidth: 32 }).layoutPriority(2),
    ]).paddingHorizontal(10),
    v,
    SLIM_H,
  )
    .onTap((payload) => rowClick(ref, payload))
    .contextMenu(threadMenu(ref, v));
  // A second click on a closed thread would open it twice over.
  return th ? row.onDoubleTap(() => editing.set(ref)) : row;
}

// cmux sends a field's text on Return and when it loses focus alike.
function RenameRow(ref, height) {
  const th = threads.get(ref);
  return TextField(th ? threadTitle(th.w) : recordOf(ref)?.title ?? "", {
    placeholder: "Thread title",
    onSubmit: (text) => rename(ref, text),
    onCancel: () => editing.set(null),
  })
    .font(14)
    .paddingHorizontal(10)
    .paddingVertical(8)
    .cornerRadius(6)
    .background("#7f7f7f2e")
    .frame({ maxWidth: "infinity", height });
}
function NoticeRow() {
  const n = notice.peek() ?? {};
  return HStack({ spacing: 8 }, [
    Image(n.icon ?? "exclamationmark.circle").font(12).color("secondary"),
    Text(n.text ?? "").font(12).color("secondary").lineLimit(1).truncation("tail"),
    Spacer({ minLength: 8 }),
    ...(n.undo
      ? [Text("Undo").font(12).weight("medium").color("primary").lineLimit(1)
          .paddingHorizontal(8).paddingVertical(3).cornerRadius(5)
          .background("#7f7f7f1f").hoverBackground("#7f7f7f40")
          .onTap(() => {
            notice.set(null);
            n.undo();
          })]
      : []),
  ])
    .paddingHorizontal(10)
    .cornerRadius(6)
    .background("#7f7f7f14")
    .frame({ height: NOTICE_H, maxWidth: "infinity" });
}
function entryView(entry) {
  const e = entry();
  if (e.kind === "notice") return NoticeRow().fixed();
  if (e.kind === "edit") return RenameRow(e.id, e.height).fixed();
  if (e.kind === "card") return ThreadCard(e.id);
  return ShelfRow(e.kind, e.id);
}
function ShelfHeader(label, count, isOpen, color, line) {
  return HStack({ spacing: 8 }, [
    Text(() => (isOpen.get() ? label : label + " (" + count() + ")")).font(12).weight("medium").color(color),
    Rectangle().fill(line).frame({ height: 1, maxWidth: "infinity" }),
    Image("chevron.down").font(10).color(color).rotation(() => (isOpen.get() ? 180 : 0)),
  ])
    .paddingHorizontal(8)
    .frame({ height: 32, maxWidth: "infinity" })
    .onTap(() => {
      closeMenus();
      isOpen.set(!isOpen.peek());
    });
}

// ── Views: menus ────────────────────────────────────────────────────────────

// Menus float over the list: cmux has no popover, so they're laid over it.
// A click on anything else in the sidebar closes them; one in the terminal
// never reaches the sidebar, so there they stay open.
function Popup(rows, maxWidth) {
  return VStack({ spacing: 0, alignment: "leading" }, rows)
    .padding(4)
    .cornerRadius(10)
    .background("thickMaterial")
    .borderColor("#7f7f7f40")
    .borderWidth(1)
    .frame({ maxWidth });
}
function PopupItem(children, onTap) {
  return HStack({ spacing: 8 }, children).paddingHorizontal(10).paddingVertical(5).cornerRadius(5).hoverBackground("#7f7f7f24").frame({ maxWidth: "infinity" }).onTap(onTap);
}
function ProjectMenu(mode) {
  const { home } = projects.peek();
  const choose = (dir) => {
    picker.set(null);
    if (mode === "new") newThread(dir);
    else setScope(dir);
  };
  const short = (dir) => (home && (dir === home || dir.startsWith(home + "/")) ? "~" + dir.slice(home.length) : dir);
  // The label outranks the spacer, or cmux halves the width between them.
  const label = (title, subtitle) =>
    VStack({ spacing: 0, alignment: "leading" }, [
      Text(title).font(13).lineLimit(1).truncation("tail"),
      Text(subtitle).font(11).color("tertiary").lineLimit(1).truncation("head"),
    ]).layoutPriority(1);
  const check = (on) => Image("checkmark").font(11).weight("semibold").color("secondary").opacity(on ? 1 : 0);
  const favorite = (dir) => (sharedVer.get(), shared.favorites.includes(dir));
  const star = (dir) =>
    Image(() => (favorite(dir) ? "star.fill" : "star"))
      .font(11)
      .color(() => (favorite(dir) ? WARNING : "tertiary"))
      .padding(3)
      .cornerRadius(5)
      .hoverBackground(PALETTE.control)
      .showOnHover(() => !favorite(dir))
      .onTap(() => toggleFavorite(dir));
  const dirs = mode === "new" ? newThreadProjects() : activeProjects(scope.peek());
  const rows = dirs.map((dir) =>
    PopupItem([ProjectBadge(() => dir), label(projectName(dir, projects.peek()), short(dir)), Spacer({ minLength: 8 }), mode === "new" ? star(dir) : check(scope.peek() === dir)], () => choose(dir)));
  const head = mode === "new"
    ? [
        Text("New thread in…").font(11).color("tertiary").paddingHorizontal(10).paddingVertical(4),
        PopupItem([Image("house").font(11).color("secondary").frame({ width: 16 }), label(NO_PROJECT, "~ · home folder"), Spacer({ minLength: 8 })], () => choose(home ?? "~")),
      ]
    : [PopupItem([Image("folder").font(12).color("secondary").frame({ width: 16 }), Text("All projects").font(13).lineLimit(1).layoutPriority(1), Spacer({ minLength: 8 }), check(!scope.peek())], () => choose(null))];
  return Popup([...head, ...(rows.length ? [Divider().padding(4), ...rows] : [])], 260);
}
function SnoozeMenu(id) {
  const items = snoozePresets(clock).map((p) =>
    PopupItem([Text(p.label).font(13).lineLimit(1), Spacer({ minLength: 12 }), Text(p.time).font(12).monospaced().color("tertiary").lineLimit(1)], () => snooze(bulk(id), p.at)));
  const custom = PopupItem([Text("Custom…").font(13).lineLimit(1), Spacer({ minLength: 0 })], () => {
    snoozeFor.set(null);
    customFor.set(id);
  });
  return Popup([...items, Divider().padding(4), custom], 200);
}
// Return and clicking away reach the sidebar as the same event, so neither
// snoozes: the Snooze button does. Esc or Cancel closes.
function CustomSnooze(id) {
  let text = "";
  const button = (label, onTap) => Text(label).font(12).paddingHorizontal(10).paddingVertical(4).cornerRadius(5).hoverBackground("#7f7f7f4a").onTap(onTap);
  return Popup([
    VStack({ spacing: 4, alignment: "leading" }, [
      Text("Custom snooze").font(12).weight("medium").color("secondary"),
      TextField("", {
        placeholder: "45m, 2h, 3d or 17:30",
        onEdit: (t) => (text = t ?? ""),
        onSubmit: (t) => (text = t ?? text),
        onCancel: () => customFor.set(null),
      }).font(13),
      HStack({ spacing: 8 }, [
        Spacer(),
        button("Cancel", () => customFor.set(null)).color("secondary"),
        button("Snooze", () => {
          const at = parseCustomSnooze(text, clock);
          if (at) return snooze(bulk(id), at);
          customFor.set(null);
          notify("Snooze takes 45m, 2h, 3d or a time like 17:30", { anchor: { after: id } });
        }).weight("medium").color("primary").background("#7f7f7f2e"),
      ]),
    ]).padding(4),
  ], 260);
}
// Where a card's menu goes: under the card's first line.
function cardTop(id) {
  let y = 0;
  for (const e of cards()) {
    if (e.id === id) return y + 30;
    y += (e.kind === "notice" ? NOTICE_H : CARD_H) + ROW_GAP;
  }
  return y;
}
function Floating(menu, top) {
  return VStack({ spacing: 0 }, [menu]).paddingTop(top).paddingTrailing(14);
}
function menuFor(target, prefix, build) {
  return ForEach({ items: () => (target.get() ? [target.get()] : []), key: (x) => prefix + x }, (_, key) => build(key.slice(prefix.length)));
}

// ── Views: layout ───────────────────────────────────────────────────────────

function IconButton(icon, onTap) {
  return Image(icon).font(13).color("secondary").frame({ width: 28, height: 28 }).cornerRadius(6).hoverBackground("#7f7f7f24").onTap(onTap);
}
function togglePicker(mode) {
  snoozeFor.set(null);
  customFor.set(null);
  picker.set(picker.peek() === mode ? null : mode);
}
function Header() {
  return HStack({ spacing: 2 }, [
    HStack({ spacing: 6 }, [
      Image("magnifyingglass").font(13).color("tertiary"),
      // A field keeps the text it was made with, so Esc swaps in an empty one.
      ForEach({ items: () => [searchGeneration.get()], key: (g) => "q" + g }, () =>
        TextField("", {
          placeholder: "Search",
          autofocus: false,
          onEdit: (t) => query.set(t ?? ""),
          onSubmit: (t) => query.set(t ?? ""),
          onCancel: () => {
            query.set("");
            searchGeneration.set(searchGeneration.peek() + 1);
          },
        }).font(14)),
    ]).paddingHorizontal(8).frame({ height: 32, maxWidth: "infinity" }),
    ZStack({}, [
      Image("folder").font(13).color("secondary").opacity(() => (scope.get() ? 0 : 1)),
      ProjectBadge(() => scope.get() ?? "").opacity(() => (scope.get() ? 1 : 0)),
    ])
      .frame({ width: 28, height: 28 })
      .cornerRadius(6)
      .background(() => (picker.get() === "scope" ? "#7f7f7f24" : null))
      .hoverBackground("#7f7f7f24")
      .onTap(() => togglePicker("scope")),
    // In a project filter: a thread there. Shift-click: next to the open one.
    IconButton("square.and.pencil", (payload) => {
      const here = threads.get(selected.peek())?.w.directory;
      if (scope.peek()) newThread(scope.peek());
      else if (payload && payload.shift) newThread(here);
      else if (newThreadProjects().length) togglePicker("new");
      else newThread(projects.peek().home ?? here);
    }),
  ]).paddingHorizontal(8).paddingVertical(6);
}
function emptyText() {
  if (query.get().trim()) return "No matching threads";
  if (!scope.get()) return "No threads yet";
  return scope.get() === projects.get().home ? "No threads without a project yet" : "No threads in " + projectName(scope.get(), projects.get()) + " yet";
}
function ThreadList() {
  const hidden = () => settled().length - settledShown.get();
  return VStack({ spacing: 0, alignment: "leading" }, [
    VStack({ spacing: ROW_GAP, alignment: "leading" }, [
      Reorderable({ items: cards, key: (e) => e.key, spacing: ROW_GAP, onMove: handleMove }, entryView),
      when(isEmpty, "empty", () => Text(emptyText).font(13).color("tertiary").paddingHorizontal(10).paddingVertical(12)),
    ]).paddingHorizontal(8),
    VStack({ spacing: 0, alignment: "leading" }, [
      when(() => snoozed().length > 0, "snoozed", () => ShelfHeader("Snoozed", () => snoozed().length, snoozedOpen, INFO, INFO + "33")),
      ForEach({ items: snoozedEntries, key: (e) => e.key }, entryView),
      when(() => !isEmpty(), "settled", () => ShelfHeader("Settled", () => settled().length, settledOpen, "tertiary", "#7f7f7f33")),
      ForEach({ items: settledEntries, key: (e) => e.key }, entryView),
      when(() => settledOpen.get() && hidden() > 0, "more", () =>
        HStack({ spacing: 8 }, [Image("plus").font(12), Text(() => "Show " + Math.min(hidden(), SETTLED_STEP) + " more").font(14), Spacer({ minLength: 0 })])
          .color("tertiary")
          .paddingHorizontal(10)
          .frame({ height: SLIM_H, maxWidth: "infinity" })
          .cornerRadius(6)
          .hoverBackground("#7f7f7f17")
          .onTap(() => {
            closeMenus();
            settledShown.set(settledShown.peek() + SETTLED_STEP);
          })),
    ]).paddingHorizontal(8).paddingTop(8),
  ]).frame({ maxWidth: "infinity" }).onTap(closeMenus);
}

// Runs on every change cmux reports and once a second. It reads threads
// directly, never through a signal, so it re-runs only for cmux's data.
computed(() => {
  const now = data.clock();
  const list = data.workspaces() ?? [];
  const open = data.selectedId() ?? "";
  try {
    step(now && now.epoch ? sec(now.epoch) : Math.floor(Date.now() / 1000), list, open);
    problem.set("");
  } catch (error) {
    problem.set(String((error && error.message) || error));
  }
  return 0;
});

sidebar(() =>
  VStack({ spacing: 0, alignment: "leading" }, [
    when(() => !!problem.get(), "problem", () => Text(() => "Sidebar error: " + problem.get()).font(11).color("red").padding(8)),
    Header(),
    ZStack({ alignment: "topTrailing" }, [
      ThreadList(),
      menuFor(picker, "p:", (mode) => Floating(ProjectMenu(mode), 0)),
      menuFor(snoozeFor, "m:", (id) => Floating(SnoozeMenu(id), () => cardTop(id))),
      menuFor(customFor, "x:", (id) => Floating(CustomSnooze(id), () => cardTop(id))),
    ]),
  ])
);
