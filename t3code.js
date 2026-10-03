// cmux-t3-sidebar - a T3 Code-style thread sidebar for cmux.
//
// A port of T3 Code's left sidebar (apps/web/src/components/Sidebar.tsx) to a
// cmux custom sidebar: search, project filter, new thread (incl. "No project"),
// thread cards (project badge, status, branch, PR, Claude/Codex mark), hover
// Snooze + Settle, Snoozed and Settled shelves, auto-settle, inline Undo.
//
// State: settled/snoozed state and times live in a marker line at the end of
// each workspace's cmux description (cmux saves it across restarts):
//   [t3 settled=<when> last=<last prompt>]
//   [t3 snoozed=<until> at=<when> last=<last prompt>]
//   [t3 manual=1 last=<last prompt>]   (you un-settled it: never auto-settle)
//   [t3 last=<last prompt>]
//
// Setup: see README.md.

// --- settings (T3 defaults) ------------------------------------------------------
const AUTO_SETTLE_AFTER_DAYS = 3; // sidebarAutoSettleAfterDays; null = never
const AUTO_SETTLE_ON_MERGE = true; // sidebarAutoSettleOnMerge (closed PRs always settle)
const SETTLED_PAGE = 10; // shown before "Show N more"
const SETTLED_STEP = 25; // revealed per "Show more" click
const NOTICE_SECONDS = 5;
const NOTICE_H = 36; // inline notice row

// --- colors (Tailwind 500s, readable in light and dark) ---------------------------
const INFO = "#3b82f6";
const SUCCESS = "#10b981";
const WARNING = "#f59e0b";
const INPUT = "#6366f1";
// T3 Code's sidebar palette (apps/web/src/index.css). The sidebar can't tell
// light from dark mode, so pick one here.
const APPEARANCE = "light"; // "light" | "dark"
const PALETTE = {
  light: {
    rowActive: "#FFFFFF", // --sidebar-row-active: white
    rowHover: "#FCFCFC", // --sidebar-row-hover: zinc-25
    border: "#E4E4E7", // --sidebar-border: zinc-200
    fg: "#27272A", // --foreground: zinc-800
    muted: "#71717A", // --muted-foreground / --secondary-label: zinc-500
    faint: "#71717A99", // muted at 60% (branch, pins, idle time)
    control: "#71717A1F", // hover-control wash
  },
  dark: {
    rowActive: "#FFFFFF0A", // white 4%
    rowHover: "#FFFFFF0A", // white 4%
    border: "#FFFFFF0F", // white 6%
    fg: "#F5F5F5", // neutral-100
    muted: "#8C8C8C", // neutral-500 lifted toward white
    faint: "#8C8C8C99",
    control: "#FFFFFF14",
  },
}[APPEARANCE];
const PR_COLORS = { open: "#10b981", closed: "#ef4444", merged: "#8b5cf6" };
const PROJECT_COLORS = [
  "#6b7280", "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e",
]; // gray red orange amber yellow lime green emerald teal cyan sky blue indigo violet purple fuchsia pink rose

const SETTLED = "Settled";
const CARD_H = 78; // T3 card height
const SLIM_H = 36; // snoozed / settled rows
const HEADER_H = 32; // shelf headers
const ROW_GAP = 2;
const SHELVES_TOP = 8;
const SNOOZE_RE = /^Snoozed · .* · #(\d+)$/;

// --- time ------------------------------------------------------------------------
const sec = (t) => (t > 1e12 ? Math.floor(t / 1000) : Math.floor(t));
function now() {
  const c = data.clock();
  return c && c.epoch ? sec(c.epoch) : Math.floor(Date.now() / 1000);
}
const pad2 = (n) => (n < 10 ? "0" : "") + n;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function clockTime(epoch) {
  const d = new Date(epoch * 1000);
  return d.getHours() + ":" + pad2(d.getMinutes());
}
function dayTime(epoch) {
  const d = new Date(epoch * 1000);
  const today = new Date(now() * 1000);
  return d.toDateString() === today.toDateString() ? clockTime(epoch) : DAYS[d.getDay()] + " " + clockTime(epoch);
}
// Performance: a binding re-runs whenever a signal it read changes, and the
// clock changes every second. Relative labels only need the minute (T3 also
// re-renders them once a minute), so they read this instead of now().
let minuteMemo = null; // defined with the other memos below
const nowMinute = () => (minuteMemo ? minuteMemo() * 60 : now());
// timestampFormat.ts: now / Nm / Nh / Nd (floored)
function relative(t) {
  if (!t) return "";
  const d = nowMinute() - t;
  if (d < 60) return "now";
  if (d < 3600) return Math.floor(d / 60) + "m";
  if (d < 86400) return Math.floor(d / 3600) + "h";
  return Math.floor(d / 86400) + "d";
}
// Sidebar.logic.ts: working duration Ns / Nm / Hh Mm
function duration(s) {
  s = Math.max(0, Math.floor(s));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h " + (m % 60) + "m";
}
// threadSettled.ts: wake countdown, ceiling, Nm (min 1) / Nh / Nd
function countdown(until) {
  const d = until - nowMinute();
  if (d < 3600) return Math.max(1, Math.ceil(d / 60)) + "m";
  if (d < 86400) return Math.ceil(d / 3600) + "h";
  return Math.ceil(d / 86400) + "d";
}
// threadSettled.ts snooze presets
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
    const toMonday = (8 - base.getDay()) % 7 || 7;
    const monday = at(toMonday, 9);
    out.push({ label: "Next week", at: monday, time: "Mon " + clockTime(monday) });
  }
  return out;
}
// Custom snooze: a duration ("45m", "2h", "3d") or a clock time ("17:30").
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
    let at = Math.floor(x.getTime() / 1000);
    if (at <= t) at += 86400;
    return at;
  }
  return null;
}

// --- project identity (projectIdentity.ts) ---------------------------------------
// A project is a full directory path. Its label is the folder name, extended
// with parent folders only when another project shares that name
// (".../PI/learn-cpp" vs ".../old/learn-cpp" -> "PI/learn-cpp", "old/learn-cpp").
const pathSegments = (dir) => String(dir ?? "").split("/").filter(Boolean);
const baseName = (dir) => pathSegments(dir).pop() ?? "";
// Your home folder isn't a project: threads there are "No project" (T3's
// "start without a project"), and New thread can always start one there.
const NO_PROJECT = "No project";
function isHome(dir) {
  const home = homeDir();
  return !!dir && !!home && dir === home;
}
function projectLabel(dir) {
  if (isHome(dir)) return NO_PROJECT;
  return projectIndex().labels.get(dir) ?? baseName(dir);
}
function projectName(w) {
  return (w?.directory && projectLabel(w.directory)) || w?.title || "";
}
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
function projectColor(name) {
  const seed = String(name ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US") || "project";
  let index = 0;
  for (const glyph of seed) index = (index * 31 + (glyph.codePointAt(0) ?? 0)) % PROJECT_COLORS.length;
  return PROJECT_COLORS[index];
}

// --- data access -----------------------------------------------------------------
const all = () => data.workspaces() ?? [];
const groups = () => data.groups() ?? [];

// Performance: cmux re-sends the whole workspace list whenever any workspace
// changes. Each workspace gets its own signal that only fires when *its* data
// changed, so a card's bindings (which read byId) re-run only for that card.
const wsSignals = new Map(); // id -> { read, write, json }
function wsEntry(id) {
  let e = wsSignals.get(id);
  if (!e) {
    const [read, write] = signal(undefined);
    e = { read, write, json: "" };
    wsSignals.set(id, e);
  }
  return e;
}
computed(() => {
  const seen = new Set();
  for (const w of all()) {
    seen.add(w.id);
    const e = wsEntry(w.id);
    const json = JSON.stringify(w);
    if (json !== e.json) {
      e.json = json;
      e.write(w);
    }
  }
  for (const [id, e] of wsSignals) {
    if (!seen.has(id) && e.json) {
      e.json = "";
      e.write(undefined);
    }
  }
  return 0;
});
const byId = (id) => (id ? wsEntry(id).read() : undefined);

// A derived value that only notifies when it really changed (by `key`, default
// the value itself): downstream bindings don't re-run for equal results.
function memo(fn, key) {
  const [read, write] = signal(undefined);
  let last = {};
  computed(() => {
    const value = fn();
    const k = key ? key(value) : value;
    if (k !== last) {
      last = k;
      write(value);
    }
    return 0;
  });
  return read;
}
const idsKey = (list) => list.map((w) => w.id).join(",");
minuteMemo = memo(() => Math.floor(now() / 60));
// Home folder (for "No project"), memoized so labels don't track the whole list.
const homeMemo = memo(() => {
  for (const w of all()) {
    const m = /^\/Users\/[^/]+/.exec(w.directory ?? "");
    if (m) return m[0];
  }
  return null;
});
// --- Input vs Done ------------------------------------------------------------------
// Input = the agent is blocked on you mid-run (permission prompt, plan approval,
// a question). Done = the run finished and you haven't looked yet (unread).
// cmux reports both a real request AND Claude Code's "waiting for your input"
// idle reminder (sent about a minute after a reply finishes) as needs_input.
// A real request arrives while the agent is working; the reminder arrives after
// it went idle - so the transition decides. A session first seen already in
// needs_input (the sidebar reloaded, cmux restarted) counts as the reminder:
// it stays up until your next prompt, while real requests get answered, and
// nothing else tells them apart (latestMessage is your prompt, not cmux's).
const prevRaw = new Map(); // agent session id -> last raw status the engine saw
const inputClass = new Map(); // session id -> { since, real }
function isRealInput(a) {
  const since = a.sinceEpoch ?? 0;
  const known = inputClass.get(a.id);
  if (known && known.since === since) return known.real;
  const prev = prevRaw.get(a.id);
  if (prev === "working") return true;
  if (prev === "needs_input" && known) return known.real; // same wait, re-stamped
  return false;
}
function agentState(w) {
  const agents = w?.agents ?? [];
  if (agents.some((a) => a.status === "needs_input" && isRealInput(a))) return "input";
  if (agents.some((a) => a.status === "working")) return "working";
  return null;
}
function workingSince(w) {
  const a = (w?.agents ?? []).find((x) => x.status === "working");
  return a ? sec(a.sinceEpoch ?? a.lastActivityAt ?? now()) : now();
}
// Title like T3: the conversation, not the terminal. Claude Code / Codex put a
// spinner glyph and a generic name ("✳ Claude Code") in the terminal title;
// a real title there (a topic Claude Code set, or your own rename) still wins.
const TITLE_GLYPHS = /^[\s\u2722-\u273D\u00B7*\u2800-\u28FF\u2022\u25CF\u25D0-\u25D3\u23FA]+/u;
const GENERIC_TITLE = /^(claude( code)?|codex|openai codex|zsh|bash|fish|sh|login|~|~?\/.*)$/i;
const SHELL_TITLE = /^\S+@\S+:/;
// Sessions still running (cmux keeps ended ones around after you quit the agent).
const liveAgents = (w) => (w?.agents ?? []).filter((a) => a.status !== "ended");
function agentKind(w) {
  const k = String(liveAgents(w)[0]?.kind ?? "").toLowerCase();
  return k.includes("claude") ? "claude" : k.includes("codex") ? "codex" : k ? "other" : null;
}
function threadTitle(w) {
  if (!w) return "";
  const raw = String(w.title ?? "").replace(TITLE_GLYPHS, "").trim();
  const agents = w.agents ?? [];
  if (!agents.length) return raw || w.title || "";
  if (raw && !GENERIC_TITLE.test(raw) && !SHELL_TITLE.test(raw)) return raw;
  const convo = agents.find((a) => a.title)?.title ?? w.latestPrompt ?? "";
  const line = String(convo).split("\n").map((x) => x.trim()).find(Boolean) ?? "";
  return line ? (line.length > 120 ? line.slice(0, 119) + "…" : line) : raw || (agents[0].name ?? "New thread");
}
function prOf(w) {
  return w?.pr ?? null;
}

// --- optimistic state ------------------------------------------------------------
// Every action flips local state the same frame; overrides clear themselves
// once cmux's data (refreshed about once a second) agrees, or after 10s.
const [tick, setTick] = signal(0);
const bump = () => setTick(tick() + 1);
const shelfOverride = new Map(); // id -> { shelf, until?, at }
const woke = new Map(); // id -> wokeAt (Woke pill)
const snoozedWhileWorking = new Set(); // a run already going when snoozed may wake it on finishing
const wakeAnchor = new Map(); // id -> id of the active row that followed it when snoozed
let selectOverride = null;

// Shelf state and times live in one marker line at the end of the workspace's
// cmux description, which cmux saves across restarts (it does NOT save prompt
// times, and agent activity times reset when it restores sessions):
//   [t3 settled=<when> last=<last prompt>]
//   [t3 snoozed=<until> at=<when> last=<last prompt>]
//   [t3 manual=1 last=<last prompt>]   you un-settled it: never auto-settle (T3)
//   [t3 last=<last prompt>]            just the last prompt time
// The older "[t3:settled]" / "[t3:snoozed:<until>]" forms are still read (and
// upgraded once). Any other description text is kept as is.
const MARKER_RE = /\s*\[t3(?::(settled|snoozed:(\d+))|((?:\s+[a-z]+=\d+)*))\]\s*$/;
// cmux applies a description change a moment later; until its data shows what
// we wrote, read our own pending write - so a second write in between (e.g. the
// prompt-time save right after a settle) builds on it instead of undoing it.
const pendingDesc = new Map(); // workspace id -> { desc, at }
function descriptionOf(w) {
  const p = w && pendingDesc.get(w.id);
  if (p) {
    if ((w.description ?? "") === p.desc) pendingDesc.delete(w.id);
    else return p.desc;
  }
  return w?.description ?? "";
}
function markerFields(w) {
  const m = MARKER_RE.exec(descriptionOf(w));
  if (!m) return {};
  if (m[1]) return m[2] ? { snoozed: +m[2], legacy: 1 } : { settled: 0, legacy: 1 };
  const f = {};
  for (const kv of (m[3] ?? "").trim().split(/\s+/).filter(Boolean)) {
    const [k, v] = kv.split("=");
    f[k] = +v;
  }
  return f;
}
function markerOf(w) {
  const f = markerFields(w);
  const last = f.last ?? 0;
  if (f.snoozed !== undefined) return { shelf: "snoozed", until: f.snoozed, at: f.at ?? null, last, legacy: !!f.legacy };
  if (f.settled !== undefined) return { shelf: "settled", at: f.settled || null, last, legacy: !!f.legacy };
  return { shelf: "active", manual: !!f.manual, last };
}
// fields: e.g. { settled: t, last: t } - zero/empty fields are dropped; {} or
// null removes the marker (and the description, if nothing else was in it).
function writeMarker(id, fields) {
  const w = byId(id);
  const current = descriptionOf(w);
  const base = current.replace(MARKER_RE, "");
  const parts = Object.entries(fields ?? {})
    .filter(([k, v]) => k !== "legacy" && v)
    .map(([k, v]) => k + "=" + Math.floor(v));
  const next = parts.length ? (base ? base + "\n" : "") + "[t3 " + parts.join(" ") + "]" : base;
  if (next === current) return;
  // (No bump() here: shelf changes - settle/snooze/wake - re-render themselves,
  // and a prompt-time save changes nothing on screen. Bumping on every save
  // re-checked every card on each prompt.)
  pendingDesc.set(id, { desc: next, at: now() });
  if (next) cmux("workspace.action", { action: "set_description", workspace_id: id, description: next });
  else cmux("workspace.action", { action: "clear_description", workspace_id: id });
}
// Last prompt you sent there: cmux's value this session, else the saved one.
function lastPrompt(w) {
  return Math.max(w?.latestAt ? sec(w.latestAt) : 0, markerFields(w).last ?? 0);
}
function shelfOf(w) {
  tick();
  // Always judge by the workspace's current data: memoized lists can hold an
  // older copy, and an old copy must never confirm (and drop) an override.
  if (w) w = byId(w.id) ?? w;
  const actual = markerOf(w);
  const o = w && shelfOverride.get(w.id);
  if (o) {
    const agrees = o.shelf === actual.shelf && (o.shelf !== "snoozed" || o.until === actual.until);
    if (agrees) shelfOverride.delete(w.id);
    else return o;
  }
  return actual;
}
function isSelected(w) {
  tick();
  if (!w) return false;
  const selected = data.selectedId();
  if (selectOverride) {
    if (selected === selectOverride) selectOverride = null;
    else return w.id === selectOverride;
  }
  return selected ? w.id === selected : !!w.selected;
}
const isWoke = (id) => (tick(), woke.has(id));

// --- top status (Sidebar.tsx resolveTopStatus) -------------------------------------
// No clock read here, so icon/color/dimming bindings don't re-run every second;
// statusText() adds the ticking "Working 12s" for the one label that needs it.
function topStatus(w) {
  const s = agentState(w);
  if (s === "input") return { kind: "input", icon: "questionmark.bubble", color: INPUT, text: "Input" };
  if (s === "working") return { kind: "working", icon: "circle.dashed", color: INFO, text: "Working" };
  if (isWoke(w?.id)) return { kind: "woke", icon: "alarm", color: WARNING, text: "Woke" };
  if ((w?.unread ?? 0) > 0) return { kind: "done", icon: "checkmark.circle", color: SUCCESS, text: "Done" };
  return null;
}
function statusText(w) {
  const s = topStatus(w);
  if (!s) return relative(lastPrompt(w));
  return s.kind === "working" ? "Working " + duration(now() - workingSince(w)) : s.text;
}
// Sidebar.logic.ts recede rule
function receded(w) {
  if (!w || isSelected(w) || isMulti(w.id)) return false;
  const s = topStatus(w)?.kind;
  if (s === "input") return false;
  if (s === "working") return true;
  if (s === "woke" || s === "done") return false;
  return !((w.unread ?? 0) > 0);
}
const canSnooze = (w) => !!w && agentState(w) !== "input";

// --- view state ------------------------------------------------------------------
const [query, setQuery] = signal("");
const [scope, setScopeRaw] = signal(null); // project directory, or null = all projects
const [picker, setPicker] = signal(null); // null | "scope" | "new"
const [pickerQuery, setPickerQuery] = signal("");
const [snoozeMenuFor, setSnoozeMenuFor] = signal(null);
const [customFor, setCustomFor] = signal(null);
const [editingId, setEditingId] = signal(null);
const [settledShown, setSettledShown] = signal(SETTLED_PAGE);
const [snoozedExpanded, setSnoozedExpanded] = signal(false);
const [settledLocalExpanded, setSettledLocalExpanded] = signal(false);
const [notice, setNotice] = signal(null); // { text, at, undo?, anchor?, icon, settled? }
const multi = new Set();
let lastClicked = null;

function setScope(dir) {
  setScopeRaw(dir);
  setSettledShown(SETTLED_PAGE); // paging resets when the scope changes
}
const isMulti = (id) => (tick(), multi.has(id));
const bulkIds = (id) => (multi.has(id) ? Array.from(multi) : [id]);
// Notices show inline in the thread list where you acted, so they're always in
// view (the sidebar scrolls and can't pin anything to the window's bottom).
// anchor: { before: id | null } - where a settled/snoozed card used to be
// (null = end of the list); { after: id } - under a card; none - list top.
function showNotice(text, undo, anchor, icon, extra) {
  setNotice({ ...extra, text, at: now(), undo, anchor, icon: icon ?? (undo ? "checkmark.circle" : "exclamationmark.circle") });
}

// --- projects --------------------------------------------------------------------
const projectIndex = memo(() => {
  const dirs = Array.from(new Set(all().map((w) => w.directory).filter((d) => d && !isHome(d)))).sort((a, b) => a.localeCompare(b));
  const segs = new Map(dirs.map((d) => [d, pathSegments(d)]));
  const tail = (d, n) => segs.get(d).slice(-n).join("/");
  const labels = new Map();
  for (const d of dirs) {
    let n = 1;
    while (n < segs.get(d).length && dirs.some((o) => o !== d && tail(o, n) === tail(d, n))) n++;
    labels.set(d, tail(d, n));
  }
  return { dirs, labels };
}, (v) => v.dirs.join("\n"));
// Projects, sorted by full path.
function projects() {
  return projectIndex().dirs.map((dir) => ({ dir, name: projectLabel(dir) }));
}
const scopeName = () => (scope() ? projectLabel(scope()) : "");

// --- lists -----------------------------------------------------------------------
function matchesSearch(w) {
  const q = query().trim().toLowerCase();
  if (!q) return true;
  if (threadTitle(w).toLowerCase().includes(q) || (w.title ?? "").toLowerCase().includes(q)) return true;
  const n = q.replace(/^#/, "");
  const prs = w.prs ?? (w.pr ? [w.pr] : []);
  return /^\d+$/.test(n) && prs.some((p) => String(p.number).startsWith(n));
}
// Lists only notify when membership or order changes (consumers use ids; card
// content comes from the per-workspace signals).
const visible = memo(() => {
  tick();
  return all().filter((w) => !isOldHeader(w) && (!scope() || w.directory === scope()) && matchesSearch(w));
}, idsKey);
const fresh = (list) => list.map((w) => byId(w.id) ?? w);
const pinnedRows = memo(() => fresh(visible()).filter((w) => shelfOf(w).shelf === "active" && w.pinned), idsKey);
const activeRows = memo(() => fresh(visible()).filter((w) => shelfOf(w).shelf === "active" && !w.pinned), idsKey);
const cardRows = memo(() => fresh([...pinnedRows(), ...activeRows()]), idsKey);
// Order inside a shelf: Snoozed wakes soonest first; Settled is newest first
// (T3, falling back to the last prompt).
function shelfSortKey(w) {
  const s = shelfOf(w);
  return s.shelf === "snoozed" ? s.until : s.shelf === "settled" ? -(s.at || lastPrompt(w)) : 0;
}
const byShelfKey = (a, b) => shelfSortKey(a) - shelfSortKey(b);
const snoozedRows = memo(() =>
  fresh(visible()).filter((w) => shelfOf(w).shelf === "snoozed").sort(byShelfKey), idsKey);
const settledRows = memo(() =>
  fresh(visible()).filter((w) => shelfOf(w).shelf === "settled").sort(byShelfKey), idsKey);

// --- cmux mutations --------------------------------------------------------------
function selectWorkspace(id) {
  if (!id) return;
  selectOverride = id;
  bump();
  cmux("workspace.select", { workspace_id: id });
}
function newThread(dir) {
  const params = { focus: "true" };
  if (dir) params.working_directory = dir;
  cmux("workspace.create", params);
}
// Where the first of these cards sits now, as "before the next remaining card".
function anchorForRemoval(ids) {
  const cards = cardRows().map((w) => w.id);
  const first = cards.findIndex((id) => ids.includes(id));
  if (first < 0) return undefined;
  const next = cards.slice(first + 1).find((id) => !ids.includes(id));
  return { before: next ?? null };
}
// Settling/snoozing the open thread moves to the next card (wrapping), or, when
// none is left, opens a fresh "No project" thread (home folder) - not a copy of
// the thread that was just settled/snoozed.
function moveSelectionAway(ids) {
  const selected = all().find((w) => isSelected(w));
  if (!selected || !ids.includes(selected.id)) return;
  const cards = cardRows().map((w) => w.id);
  const start = cards.indexOf(selected.id);
  for (let i = 1; i <= cards.length; i++) {
    const next = cards[(start + i + cards.length) % cards.length];
    if (next && !ids.includes(next)) return selectWorkspace(next);
  }
  newThread(homeDir() ?? "~");
}

function settle(ids, auto) {
  const ok = ids.filter((id) => {
    const w = byId(id);
    return w && agentState(w) === null && shelfOf(w).shelf !== "settled";
  });
  if (!ok.length) {
    if (!auto) showNotice("Can't settle: thread has active work", null, { after: ids[0] });
    return;
  }
  const anchor = auto ? undefined : anchorForRemoval(ok);
  const before = new Map(ok.map((id) => [id, markerFields(byId(id))]));
  const wasPinned = ok.filter((id) => byId(id)?.pinned);
  for (const id of wasPinned) cmux("workspace.action", { action: "unpin", workspace_id: id });
  if (!auto) moveSelectionAway(ok);
  for (const id of ok) {
    shelfOverride.set(id, { shelf: "settled", at: now() });
    woke.delete(id);
    writeMarker(id, { settled: now(), last: lastPrompt(byId(id)) });
  }
  bump();
  if (!auto) {
    // Settling again while the notice is up adds to it: one count, one Undo.
    const prev = notice();
    const last = prev?.settled && now() - prev.at < NOTICE_SECONDS ? prev.settled : null;
    const batch = {
      ids: [...(last?.ids ?? []), ...ok],
      before: new Map([...(last?.before ?? []), ...before]),
      pinned: [...(last?.pinned ?? []), ...wasPinned],
    };
    const n = batch.ids.length;
    showNotice("Settled " + n + " thread" + (n === 1 ? "" : "s"), () => {
      restoreMarkers(batch.ids, batch.before);
      for (const id of batch.pinned) cmux("workspace.action", { action: "pin", workspace_id: id });
    }, anchor, undefined, { settled: batch });
  }
}
// Back to the active list. manual = you did it (un-settle, pin): auto-settle
// then leaves the thread alone for good, like T3's manual override.
function toActive(ids, manual) {
  for (const id of ids) {
    shelfOverride.set(id, { shelf: "active", at: now() });
    writeMarker(id, { manual: manual ? 1 : 0, last: lastPrompt(byId(id)) });
  }
  bump();
}
// Undo: put the markers back exactly as they were.
function restoreMarkers(ids, before) {
  for (const id of ids) {
    const f = before.get(id) ?? {};
    const shelf = f.snoozed !== undefined ? "snoozed" : f.settled !== undefined ? "settled" : "active";
    shelfOverride.set(id, { shelf, until: f.snoozed, at: now() });
    writeMarker(id, f);
  }
  bump();
}
function unsettle(ids, manual = true) {
  toActive(ids, manual);
  // Un-settling jumps to the top of the active list.
  for (const id of [...ids].reverse()) cmux("workspace.action", { action: "move_top", workspace_id: id });
}
function snooze(ids, until) {
  const ok = ids.filter((id) => canSnooze(byId(id)));
  if (!ok.length || !(until > now())) return;
  const anchor = anchorForRemoval(ok);
  const cards = cardRows().map((w) => w.id);
  for (const id of ok) {
    const after = cards.slice(cards.indexOf(id) + 1).find((x) => !ok.includes(x));
    if (after) wakeAnchor.set(id, after);
    else wakeAnchor.delete(id);
  }
  const before = new Map(ok.map((id) => [id, markerFields(byId(id))]));
  moveSelectionAway(ok);
  for (const id of ok) {
    shelfOverride.set(id, { shelf: "snoozed", until, at: now() });
    woke.delete(id);
    if (agentState(byId(id)) === "working") snoozedWhileWorking.add(id);
    writeMarker(id, { snoozed: until, at: now(), last: lastPrompt(byId(id)) });
  }
  setSnoozeMenuFor(null);
  setCustomFor(null);
  bump();
  showNotice("Snoozed until " + dayTime(until), () => restoreMarkers(ok, before), anchor, "clock");
}
function wake(ids, automatic) {
  toActive(ids, false);
  for (const id of ids) {
    snoozedWhileWorking.delete(id);
    if (automatic) woke.set(id, now());
    // Return to the original position: before the row that followed it.
    const anchor = wakeAnchor.get(id);
    wakeAnchor.delete(id);
    const order = all().map((w) => w.id);
    const from = order.indexOf(id);
    const before = anchor && shelfOf(byId(anchor)).shelf === "active" ? order.indexOf(anchor) : -1;
    if (from >= 0 && before >= 0) cmux("workspace.reorder", { workspace_id: id, index: from < before ? before - 1 : before });
    else cmux("workspace.action", { action: "move_top", workspace_id: id });
  }
  bump();
}
function dismissWoke(id) {
  woke.delete(id);
  bump();
}

// --- one-time migration from the old group-based storage ------------------------
// Earlier versions kept shelves in cmux groups named "Settled" and
// "Snoozed · … · #<epoch>". Creating such a group made cmux spawn a header
// workspace with the group's name. Members get a description marker instead,
// the groups are dissolved, and those spawned header workspaces (exact group
// name as title, no agent session) are closed.
const migratedGroups = new Set();
const closedHeaders = new Set();
function isOldHeader(w) {
  return (w.title === SETTLED || SNOOZE_RE.test(w.title ?? "")) && !(w.agents ?? []).length;
}
function migrateOldGroups(ws) {
  for (const g of groups()) {
    const snoozed = SNOOZE_RE.exec(g.name);
    if ((g.name !== SETTLED && !snoozed) || migratedGroups.has(g.id)) continue;
    migratedGroups.add(g.id);
    for (const w of ws) {
      if (w.group !== g.id || isOldHeader(w)) continue;
      // A member that already carries a marker has current state (settled,
      // un-settled, a prompt time): never overwrite it from the old group.
      if (MARKER_RE.test(descriptionOf(w))) continue;
      if (snoozed) {
        // Only a snooze that hasn't run out yet carries over.
        const until = +snoozed[1];
        if (until > now()) writeMarker(w.id, { snoozed: until, at: now() });
      } else {
        writeMarker(w.id, { settled: now() });
      }
    }
    // Dissolve the group, keeping its workspaces open. (workspace.group.action
    // doesn't accept "ungroup" in cmux 0.64.25, so the group used to survive
    // and be re-applied on every launch.) Taking each member out is the backup.
    cmux("workspace.group.ungroup", { group_id: g.id });
    for (const w of ws) if (w.group === g.id) cmux("workspace.group.remove", { workspace_id: w.id });
  }
  for (const w of ws) {
    if (isOldHeader(w) && !closedHeaders.has(w.id)) {
      closedHeaders.add(w.id);
      cmux("workspace.close", { workspace_id: w.id });
    }
  }
}

// --- cmux's own workspace order -------------------------------------------------
// Cmd+1…9 pick workspaces by cmux's order, not the sidebar's, and settled or
// snoozed threads stay wherever they were in it. So cmux's order is kept the
// same as the sidebar's: open threads (in cmux's order), then Snoozed, then
// Settled. cmux keeps pinned workspaces first, so they're sorted the same way
// among themselves.
const SHELF_RANK = { active: 0, snoozed: 1, settled: 2 };
let orderSent = null; // the order last asked for, until cmux shows it
function syncOrder(ws) {
  if (shelfOverride.size) return; // cmux hasn't shown our own changes yet
  const rows = ws.filter((w) => !isOldHeader(w)).map((w, i) => ({
    id: w.id,
    rank: (w.pinned ? 0 : 3) + SHELF_RANK[shelfOf(w).shelf],
    key: shelfSortKey(w),
    i,
  }));
  const have = rows.map((r) => r.id);
  const want = rows.slice().sort((a, b) => a.rank - b.rank || a.key - b.key || a.i - b.i).map((r) => r.id);
  const key = want.join(",");
  if (key === have.join(",")) {
    orderSent = null;
    return;
  }
  // Ask once per order: if cmux won't take it, don't keep fighting it.
  if (orderSent === key) return;
  orderSent = key;
  cmux("workspace.reorder_many", { workspace_ids: JSON.stringify(want) });
}

// --- background engine (wake timers, auto un-settle, auto-settle) -----------------
const prevStatus = new Map();
const upgraded = new Set();
let lastSweep = 0;
computed(() => {
  const t = now();
  const ws = all();
  groups();

  migrateOldGroups(ws);

  // Optimistic overrides / pending descriptions cmux never confirmed expire after 10s.
  let expired = false;
  for (const [id, p] of pendingDesc) {
    if (t - p.at > 10) {
      pendingDesc.delete(id);
      expired = true;
    }
  }
  for (const [id, o] of shelfOverride) {
    if (t - o.at > 10) {
      shelfOverride.delete(id);
      expired = true;
    }
  }
  if (expired) bump();

  for (const w of ws) {
    for (const a of w.agents ?? []) {
      if (a.status === "needs_input") {
        const since = a.sinceEpoch ?? 0;
        const known = inputClass.get(a.id);
        if (!known || known.since !== since) inputClass.set(a.id, { since, real: isRealInput(a) });
      }
      prevRaw.set(a.id, a.status);
    }
    const s = agentState(w);
    const prev = prevStatus.get(w.id);
    prevStatus.set(w.id, s);
    const shelf = shelfOf(w);
    const marker = markerOf(w);
    const prompt = w.latestAt ? sec(w.latestAt) : 0; // this session's last prompt
    if (marker.legacy && !upgraded.has(w.id)) {
      // Old marker without times: stamp it once.
      upgraded.add(w.id);
      writeMarker(w.id, marker.shelf === "snoozed" ? { snoozed: marker.until, at: t } : { settled: t });
    } else if (shelf.shelf === "snoozed") {
      // Wake on the timer, on a real input request, or when a run finishes that
      // was running when you snoozed it or that you started afterwards.
      const changed = prev !== undefined && prev !== s;
      const runIsNew = snoozedWhileWorking.has(w.id) || (shelf.at && prompt > shelf.at);
      if (t >= shelf.until || (changed && s === "input") || (changed && prev === "working" && s === null && runIsNew)) wake([w.id], true);
    } else if (shelf.shelf === "settled") {
      // Only a prompt you sent after settling brings it back (T3). Agent state
      // changes alone don't - cmux restores sessions on restart.
      if (shelf.at && prompt > shelf.at) unsettle([w.id], false);
    } else if (s === "working" && prev !== undefined && prev !== "working" && woke.has(w.id)) {
      dismissWoke(w.id); // sending a message (a new run starting) clears the Woke pill
    }
    // Keep the last prompt time in the marker so it survives restarts.
    if (!marker.legacy && prompt > (marker.last || 0) + 1 && !shelfOverride.has(w.id)) {
      writeMarker(w.id, { ...markerFields(w), last: prompt });
    }
  }

  // Auto-settle sweep, once a minute (ThreadSettlementService).
  if (t - lastSweep >= 60) {
    lastSweep = t;
    const due = ws.filter((w) => {
      if (shelfOf(w).shelf !== "active" || w.pinned || isSelected(w) || markerOf(w).manual) return false;
      if (agentState(w) !== null) return false; // working, or a real input request
      const pr = prOf(w);
      if (pr && (pr.status === "closed" || (AUTO_SETTLE_ON_MERGE && pr.status === "merged"))) return true;
      const last = lastPrompt(w);
      return AUTO_SETTLE_AFTER_DAYS != null && last > 0 && t - last >= AUTO_SETTLE_AFTER_DAYS * 86400;
    });
    if (due.length) settle(due.map((w) => w.id), true);
  }

  syncOrder(ws);
  return t;
});

// --- text field submits ----------------------------------------------------------
// cmux sends a text field's "submit" both for Return AND for focus loss, and a
// click on any other sidebar node blurs the field first (submit, then tap, in
// one host call). So a submit is held until the next clock tick and dropped if
// a tap follows: Return acts, clicking elsewhere (e.g. a project row) doesn't.
let pendingSubmit = null;
function deferSubmit(run) {
  pendingSubmit = { run, at: now() };
}
// A popover that loses focus hides at once (blurred), so clicking the terminal
// closes it instantly. It stays mounted (invisible, not clickable) until the
// tap that caused the blur has run - so a click on one of its options still
// lands - and is then closed for real; with no tap (terminal click) the next
// clock tick closes it.
const [blurred, setBlurred] = signal(false);
let pendingClose = null;
function blurClose(close) {
  pendingClose = close;
  setBlurred(true);
  deferSubmit(() => finishBlurClose());
}
function finishBlurClose() {
  const close = pendingClose;
  pendingClose = null;
  if (close) close();
  if (blurred()) setBlurred(false);
}
const hostDispatch = globalThis.__dispatch;
globalThis.__dispatch = (nodeId, event, json) => {
  const isTap = event === "tap" || event === "doubletap";
  if (pendingSubmit && isTap) pendingSubmit = null;
  const result = hostDispatch(nodeId, event, json);
  if (isTap && pendingClose) finishBlurClose();
  return result;
};
computed(() => {
  const t = now();
  if (pendingSubmit && t > pendingSubmit.at) {
    const p = pendingSubmit;
    pendingSubmit = null;
    p.run();
  }
  return t;
});

// --- interaction -----------------------------------------------------------------
function rowClick(id, payload) {
  setSnoozeMenuFor(null);
  setCustomFor(null);
  setPicker(null);
  if (payload && payload.cmd) {
    if (multi.has(id)) multi.delete(id);
    else multi.add(id);
    bump();
  } else if (payload && payload.shift && lastClicked) {
    const order = [...cardRows(), ...snoozedRows(), ...settledRows()].map((w) => w.id);
    const a = order.indexOf(lastClicked);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) multi.add(x);
    bump();
  } else {
    multi.clear();
    selectWorkspace(id);
  }
  lastClicked = id;
}
function afterBulk() {
  multi.clear();
  bump();
}

// threadActionMenu.logic.ts (the items cmux can do)
function threadMenu(id, shelf) {
  const w = () => byId(id);
  return [
    Button(() => (w()?.branch ? "New thread on " + w().branch : "New thread"), () => newThread(w()?.directory)),
    Button(() => (w()?.pinned ? "Unpin thread" : "Pin thread"), () => {
      const pin = !w()?.pinned;
      for (const x of bulkIds(id)) {
        if (pin && shelfOf(byId(x)).shelf !== "active") toActive([x], true); // pinning un-settles
        cmux("workspace.action", { action: pin ? "pin" : "unpin", workspace_id: x });
      }
      afterBulk();
    }),
    shelf === "settled"
      ? Button("Un-settle thread", () => { unsettle(bulkIds(id)); afterBulk(); })
      : Button("Settle thread", () => { settle(bulkIds(id)); afterBulk(); }),
    shelf === "snoozed"
      ? Button("Wake thread", () => { wake(bulkIds(id), false); afterBulk(); })
      : Button("Snooze…", () => {
        if (!canSnooze(w())) return showNotice("Can't snooze: thread is waiting for input", null, { after: id });
        setCustomFor(null);
        setSnoozeMenuFor(id);
      }),
    Divider(),
    Button("Rename thread", () => setEditingId(id)),
    Button("Mark unread", () => cmux("workspace.action", { action: "mark_unread", workspace_id: id })),
    Button(() => (scope() ? "Show all projects" : isHome(w()?.directory) ? "Show only threads without a project" : "Filter by " + projectName(w())), () =>
      setScope(scope() ? null : w()?.directory ?? null)),
    Divider(),
    Button("Close workspace", () => {
      for (const x of bulkIds(id)) cmux("workspace.close", { workspace_id: x });
      afterBulk();
    }).destructive(),
  ];
}

// --- small views -----------------------------------------------------------------
function when(cond, key, build) {
  return ForEach({ items: () => (cond() ? [key] : []), key: (k) => k }, () => build());
}
function ProjectBadge(dir) {
  const color = () => projectColor(projectLabel(dir()));
  const home = () => isHome(dir());
  return Text(() => (home() ? "\u2302" : monogram(baseName(dir()) || "PR")))
    .font(() => (home() ? 11 : 8))
    .weight("bold")
    .monospaced()
    .color(() => (home() ? "secondary" : color()))
    .frame({ width: 16, height: 16 })
    .background(() => (home() ? "#7f7f7f1f" : color() + "24"))
    .cornerRadius(4);
}
function PrBadge(w) {
  return HStack({ spacing: 3 }, [
    Image("arrow.triangle.pull").font(10),
    Text(() => (prOf(w()) ? String(prOf(w()).number) : "")).font(12),
  ])
    .color(() => PR_COLORS[prOf(w())?.status] ?? "secondary")
    .opacity(() => (prOf(w()) ? 1 : 0))
    .layoutPriority(2)
    .onTap(() => prOf(w())?.url && openURL(prOf(w()).url));
}
// Provider mark. The sidebar can only draw SF Symbols and text, so these are
// stand-ins, not the real logos: Claude Code's own ✻ glyph, and a generic
// symbol for Codex.
function ProviderMark(w) {
  const kind = () => agentKind(w());
  return Text(() => ({ claude: "\u273B", codex: "\u269B\uFE0E", other: "\u2726" })[kind()] ?? "")
    .font(() => (kind() === "claude" ? 13 : 12))
    .color(() => (kind() === "claude" ? "#D97757" : "secondary"))
    .opacity(() => (kind() === "claude" ? 1 : 0.6))
    .frame({ width: () => (kind() ? 14 : 0), height: 14 })
    .help(() => liveAgents(w())[0]?.name ?? "");
}
function IconButton(icon, help, onTap) {
  return Image(icon)
    .font(13)
    .color("secondary")
    .frame({ width: 28, height: 28 })
    .cornerRadius(6)
    .hoverBackground("#7f7f7f24")
    .help(help)
    .onTap(onTap);
}
function ShelfHeader(label, count, expanded, toggle, tone) {
  const textColor = tone === "info" ? INFO : "tertiary";
  const lineColor = tone === "info" ? INFO + "33" : "#7f7f7f33";
  return HStack({ spacing: 8 }, [
    Text(() => (expanded() ? label : label + " (" + count() + ")")).font(12).weight("medium").color(textColor),
    Rectangle().fill(lineColor).frame({ height: 1, maxWidth: "infinity" }),
    Image("chevron.down").font(10).color(textColor).rotation(() => (expanded() ? 180 : 0)),
  ])
    .paddingHorizontal(8)
    .frame({ height: 32, maxWidth: "infinity" })
    .onTap(toggle);
}

// --- thread card (pinned + active) -------------------------------------------------
// T3 dims working rows to 70%. (It also fades them back on hover; doing that
// in cmux needs every dimmed part drawn twice, which doubled the cost of every
// sidebar update and made scrolling stutter - so the dimming stays, the hover
// fade doesn't. The Snooze/Settle hover controls are never dimmed.)
function HoverUndim(dimmed, build) {
  return build().opacity(() => (dimmed() ? 0.7 : 1));
}

function ThreadCard(id) {
  const w = () => byId(id);
  // Per-card memos: selecting another thread or a global state bump only
  // re-runs this card's bindings when its own selected/status/recede changed.
  const status = memo(() => topStatus(w()), (st) => (st ? st.kind : ""));
  const selected = memo(() => isSelected(w()));
  const dimmed = memo(() => status()?.kind === "working" && !selected() && !isMulti(id));
  const isReceded = memo(() => receded(w()));
  return VStack({ spacing: 0, alignment: "leading" }, [
    // Line 1: project + status slot (hover cross-fades the status into Snooze / Settle)
    HStack({ spacing: 6 }, [
      // Priorities (cmux splits leftover width between flexible views): the
      // status/controls slot never shrinks (T3 shrink-0), the project label
      // comes next, the spacer last - so nothing truncates while there's room.
      HoverUndim(dimmed, () => HStack({ spacing: 6 }, [
        ProjectBadge(() => w()?.directory),
        Text(() => projectName(w()))
          .font(12)
          .weight(() => (isReceded() ? "regular" : "medium"))
          .color(PALETTE.muted)
          .lineLimit(1)
          .truncation("tail"),
        Image("pin.fill").font(9).color(PALETTE.faint).frame({ width: () => (w()?.pinned ? 10 : 0) }).opacity(() => (w()?.pinned ? 1 : 0)),
      ])).layoutPriority(1),
      Spacer({ minLength: 4 }),
      ZStack({ alignment: "trailing" }, [
        HStack({ spacing: 4 }, [
          Image(() => status()?.icon ?? "circle")
            .font(12)
            .color(() => status()?.color ?? "clear")
            .frame({ width: () => (status() ? 16 : 0) }),
          Text(() => statusText(w()))
            .font(12)
            .weight(() => (status() ? "medium" : "regular"))
            .color(() => status()?.color ?? PALETTE.muted),
        ])
          .opacity(() => (dimmed() ? 0.7 : 1))
          .hideOnHover()
          .onTap(() => status()?.kind === "woke" && dismissWoke(id)),
        // Hover controls: always both, at full strength, whatever the status.
        HStack({ spacing: 8 }, [
          // Woke stays visible next to the hover controls.
          Text("Woke").font(12).weight("medium")
            .color(WARNING)
            .frame({ width: () => (status()?.kind === "woke" ? undefined : 0) })
            .opacity(() => (status()?.kind === "woke" ? 1 : 0))
            .onTap(() => dismissWoke(id)),
          Image("clock")
            .font(11)
            .color(PALETTE.muted)
            .padding(3)
            .cornerRadius(5)
            .hoverBackground(PALETTE.control)
            .help("Snooze thread")
            .onTap(() => {
              if (!canSnooze(w())) return showNotice("Can't snooze: thread is waiting for input", null, { after: id });
              setSnoozeMenuFor(snoozeMenuFor() === id ? null : id);
            }),
          Text("\u2713 Settle").font(12).lineLimit(1)
            .color(PALETTE.muted)
            .paddingHorizontal(4)
            .paddingVertical(2)
            .cornerRadius(5)
            .hoverBackground(PALETTE.control)
            .help("Settle thread")
            .onTap(() => settle([id])),
        ]).showOnHover(),
      ]).layoutPriority(2),
    ]).frame({ height: 20 }),
    // Line 2: title
    HoverUndim(dimmed, () => Text(() => threadTitle(w()))
      .font(14)
      .weight(() => (isReceded() ? "regular" : "medium"))
      .color(() => (isReceded() ? PALETTE.muted : PALETTE.fg))
      .lineLimit(1)
      .truncation("tail")
      .marquee()).paddingTop(4),
    // Line 3: branch, PR, remote machine
    HoverUndim(dimmed, () => HStack({ spacing: 6 }, [
      Text(() => w()?.branch ?? "").font(12).color(PALETTE.faint).lineLimit(1).truncation("middle"),
      PrBadge(w),
      Spacer({ minLength: 0 }),
      Image("server.rack").font(11).color(PALETTE.faint).opacity(() => (w()?.remote ? 1 : 0)).help(() => w()?.remote?.target ?? ""),
      ProviderMark(w),
    ]).frame({ maxWidth: "infinity" })).paddingTop(2),
  ])
    .paddingHorizontal(10)
    .paddingVertical(8)
    .cornerRadius(6)
    .background(() => (isMulti(id) ? "#4C9EEB33" : selected() ? PALETTE.rowActive : null))
    .hoverBackground(() => (isMulti(id) ? "#4C9EEB33" : selected() ? PALETTE.rowActive : PALETTE.rowHover))
    .frame({ maxWidth: "infinity", height: CARD_H })
    .onTap((payload) => rowClick(id, payload))
    .onDoubleTap(() => setEditingId(id))
    .contextMenu(threadMenu(id, "active"));
}

// --- slim row (snoozed + settled) ----------------------------------------------------
function SlimRow(id, shelf) {
  const w = () => byId(id);
  const selected = memo(() => isSelected(w()));
  return HStack({ spacing: 10 }, [
    ProjectBadge(() => w()?.directory).opacity(0.4),
    Text(() => threadTitle(w()))
      .font(14)
      .color(() => (selected() || isWoke(id) ? PALETTE.fg : PALETTE.faint))
      .lineLimit(1)
      .truncation("tail")
      .marquee(),
    Image("pin.fill").font(9).color(PALETTE.faint).frame({ width: () => (w()?.pinned ? 10 : 0) }).opacity(() => (w()?.pinned ? 1 : 0)),
    PrBadge(w),
    Spacer({ minLength: 0 }),
    ZStack({ alignment: "trailing" }, [
      Text(() => (shelf === "snoozed" ? countdown(shelfOf(w()).until ?? now()) : relative(shelfOf(w()).at || lastPrompt(w()))))
        .font(12)
        .color(shelf === "snoozed" ? INFO : PALETTE.faint)
        .hideOnHover(),
      Image(shelf === "snoozed" ? "alarm" : "arrow.uturn.backward")
        .font(11)
        .color(PALETTE.muted)
        .padding(3)
        .cornerRadius(5)
        .hoverBackground(PALETTE.control)
        .help(shelf === "snoozed" ? "Wake thread now" : "Un-settle thread")
        .showOnHover()
        .onTap(() => (shelf === "snoozed" ? wake([id], false) : unsettle([id]))),
    ]).frame({ minWidth: 32 }).layoutPriority(2),
  ])
    .paddingHorizontal(10)
    .frame({ height: 36, maxWidth: "infinity" })
    .cornerRadius(6)
    .background(() => (isMulti(id) ? "#4C9EEB33" : selected() ? PALETTE.rowActive : null))
    .hoverBackground(() => (isMulti(id) ? "#4C9EEB33" : selected() ? PALETTE.rowActive : PALETTE.rowHover))
    .onTap((payload) => rowClick(id, payload))
    .onDoubleTap(() => setEditingId(id))
    .contextMenu(threadMenu(id, shelf));
}

function RenameRow(id, height) {
  return TextField(() => threadTitle(byId(id)), {
    placeholder: "Thread title",
    onSubmit: (text) => {
      const title = (text ?? "").trim();
      if (title) cmux("workspace.action", { action: "rename", workspace_id: id, title });
      setEditingId(null);
    },
    onCancel: () => setEditingId(null),
  })
    .font(14)
    .paddingHorizontal(10)
    .paddingVertical(8)
    .cornerRadius(6)
    .background("#7f7f7f2e")
    .frame({ maxWidth: "infinity", height });
}

function SnoozeMenu(id) {
  const items = snoozePresets(now()).map((p) =>
    HStack({ spacing: 8 }, [Text(p.label).font(13).lineLimit(1), Spacer({ minLength: 12 }), Text(p.time).font(12).monospaced().color("tertiary").lineLimit(1)])
      .paddingHorizontal(10)
      .paddingVertical(5)
      .cornerRadius(5)
      .hoverBackground("#7f7f7f24")
      .frame({ maxWidth: "infinity" })
      .onTap(() => snooze(bulkIds(id), p.at)));
  return VStack({ spacing: 0, alignment: "leading" }, [
    // Invisible focus catcher: it takes keyboard focus when the menu opens, so
    // clicking the terminal (which sends the sidebar no event) blurs it and the
    // menu closes. A click on an option arrives right after that blur and wins.
    // Esc closes too.
    FocusCatcher(() => snoozeMenuFor() === id, () => setSnoozeMenuFor(null)),
    ...items,
    Divider().padding(4),
    HStack({ spacing: 0 }, [Text("Custom…").font(13).lineLimit(1), Spacer({ minLength: 0 })])
      .paddingHorizontal(10)
      .paddingVertical(5)
      .cornerRadius(5)
      .hoverBackground("#7f7f7f24")
      .onTap(() => { setSnoozeMenuFor(null); setCustomFor(id); }),
  ])
    .padding(4)
    .cornerRadius(10)
    .background("thickMaterial")
    .borderColor("#7f7f7f40")
    .borderWidth(1)
    .frame({ maxWidth: 200 });
}

function CustomSnooze(id) {
  // Return and clicking away arrive as the same "submit", so a submit never
  // snoozes: clicking away closes the box, the Snooze button applies it (a
  // click on it lands right after the blur and wins). Esc or Cancel closes.
  let text = "";
  const apply = () => {
    const at = parseCustomSnooze(text, now());
    if (at) snooze(bulkIds(id), at);
    else showNotice("Snooze time must be in the future", null, { after: id });
  };
  return VStack({ spacing: 4, alignment: "leading" }, [
    Text("Custom snooze").font(12).weight("medium").color("secondary"),
    TextField("", {
      placeholder: "Duration (45m, 2h, 3d) or time (17:30)",
      onEdit: (t) => { text = t ?? ""; },
      onSubmit: (t) => {
        text = t ?? text;
        blurClose(() => { if (customFor() === id) setCustomFor(null); });
      },
      onCancel: () => setCustomFor(null),
    }).font(13),
    HStack({ spacing: 8 }, [
      Spacer(),
      Text("Cancel").font(12).color("secondary").paddingHorizontal(8).paddingVertical(4).cornerRadius(5)
        .hoverBackground("#7f7f7f2e").onTap(() => setCustomFor(null)),
      Text("Snooze").font(12).weight("medium").color("primary").paddingHorizontal(10).paddingVertical(4).cornerRadius(5)
        .background("#7f7f7f2e").hoverBackground("#7f7f7f4a").onTap(apply),
    ]),
  ])
    .padding(8)
    .cornerRadius(10)
    .background("thickMaterial")
    .borderColor("#7f7f7f40")
    .borderWidth(1)
    .frame({ maxWidth: 260 });
}

// --- header + project picker ----------------------------------------------------------
function homeDir() {
  return homeMemo();
}
function shortPath(dir) {
  const home = homeDir();
  return home && (dir === home || dir.startsWith(home + "/")) ? "~" + dir.slice(home.length) : dir;
}
function togglePicker(mode) {
  setPickerQuery("");
  setPicker(picker() === mode ? null : mode);
}

function Header() {
  return HStack({ spacing: 2 }, [
    HStack({ spacing: 6 }, [
      Image("magnifyingglass").font(13).color("tertiary"),
      TextField(() => query(), {
        placeholder: "Search",
        autofocus: false,
        onEdit: (t) => setQuery(t ?? ""),
        onSubmit: (t) => setQuery(t ?? ""),
        onCancel: () => setQuery(""),
      }).font(14),
    ])
      .paddingHorizontal(8)
      .frame({ height: 32, maxWidth: "infinity" }),
    // Project scope: folder icon, or the scoped project's monogram.
    ZStack({}, [
      Image("folder").font(13).color("secondary").opacity(() => (scope() ? 0 : 1)),
      ProjectBadge(() => scope()).opacity(() => (scope() ? 1 : 0)),
    ])
      .frame({ width: 28, height: 28 })
      .cornerRadius(6)
      .background(() => (picker() === "scope" ? "#7f7f7f24" : null))
      .hoverBackground("#7f7f7f24")
      .help("Filter by project")
      .onTap(() => togglePicker("scope")),
    IconButton("square.and.pencil", "New thread", (payload) => {
      const selectedDir = all().find((w) => isSelected(w))?.directory;
      if (scope()) newThread(scope());
      else if (payload && payload.shift) newThread(selectedDir);
      else if (projects().length > 0) togglePicker("new");
      else newThread(homeDir() ?? selectedDir);
    }),
  ]).paddingHorizontal(8).paddingVertical(6);
}

// Floating panel chrome: an adaptive (light/dark) material over the list.
function Popover(content) {
  return content
    .padding(4)
    .cornerRadius(10)
    .background("thickMaterial")
    .borderColor("#7f7f7f40")
    .borderWidth(1);
}
// Invisible focus catcher shared by every dropdown (the snooze menu's recipe).
// It takes keyboard focus when the dropdown opens, so clicking the terminal
// (which sends the sidebar no event) blurs it and the dropdown hides at once;
// a click on one of the dropdown's own rows arrives right after the blur and
// still lands. Esc closes. Typing goes here too (onEdit), for type-to-filter.
function FocusCatcher(isOpen, close, onEdit) {
  return TextField("", {
    onEdit: onEdit ?? (() => {}),
    onSubmit: () => blurClose(() => { if (isOpen()) close(); }),
    onCancel: () => close(),
  }).frame({ width: 1, height: 1 }).opacity(0);
}
// Project dropdowns ("filter by project" and "New thread in…"): the snooze
// menu's recipe exactly - same floating slot, same fixed-width frosted box,
// same focus catcher, rows built once when it opens, right-aligned under the
// header buttons.
function ProjectMenu(mode) {
  const close = () => setPicker(null);
  const choose = (dir) => {
    close();
    if (mode === "new") newThread(dir);
    else setScope(dir);
  };
  // The label column outranks the spacer (cmux otherwise splits the free width
  // between them and truncates names early); the checkmark sits at the end.
  const item = (children, onTap, trailing) =>
    HStack({ spacing: 8 }, [...children, Spacer({ minLength: 8 }), ...(trailing ? [trailing] : [])])
      .paddingHorizontal(10)
      .paddingVertical(5)
      .cornerRadius(5)
      .hoverBackground("#7f7f7f24")
      .onTap(onTap);
  const check = (on) => Image("checkmark").font(11).weight("semibold").color("secondary").opacity(on ? 1 : 0);
  const label = (title, subtitle) =>
    VStack({ spacing: 0, alignment: "leading" }, [
      Text(title).font(13).lineLimit(1).truncation("tail"),
      Text(subtitle).font(11).color("tertiary").lineLimit(1).truncation("head"),
    ]).layoutPriority(1);
  const home = homeDir();
  const projectRows = projects().map((p) =>
    item([ProjectBadge(() => p.dir), label(p.name, shortPath(p.dir))],
      () => choose(p.dir), check(mode === "scope" && scope() === p.dir)));
  // Only in the New thread menu (the filter lists real projects only).
  const noProjectRow = item([Image("house").font(11).color("secondary").frame({ width: 16 }), label(NO_PROJECT, "~ · home folder")],
    () => choose(home ?? "~"));
  const head = mode === "new"
    ? [Text("New thread in…").font(11).color("tertiary").paddingHorizontal(10).paddingVertical(4), noProjectRow]
    : [
        item([Image("folder").font(12).color("secondary").frame({ width: 16 }), Text("All projects").font(13).lineLimit(1).layoutPriority(1)],
          () => choose(null), check(!scope())),
      ];
  const rows = projectRows.length ? [Divider().padding(4), ...projectRows] : [];
  return VStack({ spacing: 0, alignment: "leading" }, [
    FocusCatcher(() => picker() === mode, close),
    ...head,
    ...rows,
  ])
    .padding(4)
    .cornerRadius(10)
    .background("thickMaterial")
    .borderColor("#7f7f7f40")
    .borderWidth(1)
    .frame({ maxWidth: 260 });
}

// --- active list (drag to reorder) ------------------------------------------------------
const noticeLive = memo(() => {
  const n = notice();
  return !!n && now() - n.at < NOTICE_SECONDS;
});
const cardEntries = memo(() => {
  const out = [];
  const live = noticeLive() ? notice() : null;
  const noticeEntry = live && { key: "n:" + live.at + ":" + live.text, kind: "notice", id: null };
  let placed = false;
  const place = () => { if (noticeEntry && !placed) { out.push(noticeEntry); placed = true; } };
  for (const w of cardRows()) {
    if (live?.anchor?.before === w.id) place();
    out.push(editingId() === w.id ? { key: "e:" + w.id, kind: "edit", id: w.id, height: CARD_H } : { key: "c:" + w.id, kind: "card", id: w.id });
    if (live?.anchor?.after === w.id) place();
  }
  if (noticeEntry && !placed) {
    if (live.anchor && live.anchor.before === null) out.push(noticeEntry); // was the last card
    else out.unshift(noticeEntry); // not in the list: top
  }
  return out;
}, (list) => list.map((e) => e.key).join(","));
function handleMove(key, index) {
  const id = key.slice(2);
  const entries = cardEntries().filter((e) => e.key !== key);
  const next = entries.slice(index).find((e) => e.kind === "card");
  const prev = entries.slice(0, index).reverse().find((e) => e.kind === "card");
  const order = all().map((w) => w.id);
  const from = order.indexOf(id);
  // Dragging across the pinned boundary pins / unpins (T3 drag verbs).
  const dragged = byId(id);
  const nextPinned = next ? !!byId(next.id)?.pinned : false;
  const prevPinned = prev ? !!byId(prev.id)?.pinned : false;
  if (!dragged?.pinned && nextPinned) cmux("workspace.action", { action: "pin", workspace_id: id });
  if (dragged?.pinned && !prevPinned && prev) cmux("workspace.action", { action: "unpin", workspace_id: id });
  if (next) {
    const before = order.indexOf(next.id);
    cmux("workspace.reorder", { workspace_id: id, index: from < before ? before - 1 : before });
  } else if (prev) {
    const after = order.indexOf(prev.id);
    cmux("workspace.reorder", { workspace_id: id, index: from < after ? after : after + 1 });
  }
}

// --- shelves ------------------------------------------------------------------------------
const settledExpanded = () => settledLocalExpanded();
const toggleSettled = () => setSettledLocalExpanded(!settledLocalExpanded());
function slimEntries(rows, shelf, expanded, limit) {
  const list = rows();
  const shown = expanded() ? list.slice(0, limit ? limit() : list.length) : [];
  // The open thread is always shown, even when paged out or collapsed.
  const open = list.find((w) => isSelected(w));
  if (open && !shown.includes(open)) shown.push(open);
  const out = [];
  for (const w of shown) {
    out.push(editingId() === w.id ? { key: "e:" + w.id, kind: "edit", id: w.id, height: SLIM_H } : { key: shelf[0] + ":" + w.id, kind: shelf, id: w.id });
  }
  return out;
}
// Top of the popover for a row: just under a card's first line (over the card,
// like T3's menu under its clock button), or just under a slim row.
function popoverTop(id) {
  let y = 0;
  const cards = cardEntries();
  for (let k = 0; k < cards.length; k++) {
    if (k > 0) y += ROW_GAP;
    if (cards[k].kind !== "notice" && cards[k].id === id) return y + 30;
    y += cards[k].kind === "notice" ? NOTICE_H : CARD_H;
  }
  y += SHELVES_TOP;
  const shelves = [];
  if (snoozedRows().length) shelves.push(slimEntries(snoozedRows, "snoozed", snoozedExpanded));
  if (all().length) shelves.push(slimEntries(settledRows, "settled", settledExpanded, settledShown));
  for (const rows of shelves) {
    y += HEADER_H;
    for (const e of rows) {
      y += SLIM_H;
      if (e.id === id) return y + 2;
    }
  }
  return y;
}
function FloatingAt(id, view, top) {
  return VStack({ spacing: 0 }, [view])
    .paddingTop(top ?? (() => popoverTop(id)))
    .paddingTrailing(14)
    .opacity(() => (blurred() ? 0 : 1));
}

function NoticeRow() {
  const n = notice(); // one row per notice (keyed by its time and text)
  return HStack({ spacing: 8 }, [
    Image(n?.icon ?? "checkmark.circle").font(12).color("secondary"),
    Text(n?.text ?? "").font(12).color("secondary").lineLimit(1).truncation("tail"),
    Spacer({ minLength: 8 }),
    ...(n?.undo
      ? [Text("Undo").font(12).weight("medium").color("primary").lineLimit(1)
          .paddingHorizontal(8).paddingVertical(3).cornerRadius(5)
          .background("#7f7f7f1f").hoverBackground("#7f7f7f40")
          .onTap(() => { setNotice(null); n.undo(); })]
      : []),
  ])
    .paddingHorizontal(10)
    .cornerRadius(6)
    .background("#7f7f7f14")
    .frame({ height: NOTICE_H, maxWidth: "infinity" });
}

function entryView(e) {
  const entry = e();
  if (entry.kind === "notice") return NoticeRow().fixed();
  if (entry.kind === "edit") return RenameRow(entry.id, entry.height);
  if (entry.kind === "card") return ThreadCard(entry.id);
  return SlimRow(entry.id, entry.kind);
}

// --- root ---------------------------------------------------------------------------------
function ThreadList() {
  return VStack({ spacing: 0, alignment: "leading" }, [
    VStack({ spacing: 2, alignment: "leading" }, [
      Reorderable({ items: cardEntries, key: (e) => e.key, spacing: 2, onMove: handleMove }, entryView),
      when(() => visible().length === 0, "empty", () =>
        Text(() => (query().trim() ? "No matching threads" : scope() ? (isHome(scope()) ? "No threads without a project yet" : "No threads in " + scopeName() + " yet") : "No threads yet"))
          .font(13).color("tertiary").paddingHorizontal(10).paddingVertical(12)),
    ]).paddingHorizontal(8),

    VStack({ spacing: 0, alignment: "leading" }, [
      when(() => snoozedRows().length > 0, "snoozed", () =>
        ShelfHeader("Snoozed", () => snoozedRows().length, snoozedExpanded, () => setSnoozedExpanded(!snoozedExpanded()), "info")),
      ForEach({ items: () => slimEntries(snoozedRows, "snoozed", snoozedExpanded), key: (e) => e.key }, entryView),
      when(() => all().length > 0, "settled", () =>
        ShelfHeader("Settled", () => settledRows().length, settledExpanded, toggleSettled, "muted")),
      ForEach({ items: () => slimEntries(settledRows, "settled", settledExpanded, settledShown), key: (e) => e.key }, entryView),
      when(() => settledExpanded() && settledRows().length > settledShown(), "more", () =>
        HStack({ spacing: 8 }, [
          Image("plus").font(12),
          Text(() => "Show " + Math.min(settledRows().length - settledShown(), SETTLED_STEP) + " more").font(14),
          Spacer({ minLength: 0 }),
        ])
          .color("tertiary")
          .paddingHorizontal(10)
          .frame({ height: 36, maxWidth: "infinity", alignment: "leading" })
          .cornerRadius(6)
          .hoverBackground("#7f7f7f17")
          .onTap(() => setSettledShown(settledShown() + SETTLED_STEP))),
    ]).paddingHorizontal(8).paddingTop(8),

  ]).frame({ maxWidth: "infinity" });
}

sidebar(() =>
  VStack({ spacing: 0, alignment: "leading" }, [
    Header(),
    ZStack({ alignment: "topTrailing" }, [
      ThreadList(),
      ForEach({ items: () => (picker() ? [picker()] : []), key: (m) => "p:" + m }, (_, key) =>
        FloatingAt(null, ProjectMenu(key.slice(2)), () => 0)),
      // Snooze menu / custom snooze float under the row that opened them.
      ForEach({ items: () => (snoozeMenuFor() ? [snoozeMenuFor()] : []), key: (id) => "m:" + id }, (_, key) =>
        FloatingAt(key.slice(2), SnoozeMenu(key.slice(2)))),
      ForEach({ items: () => (customFor() ? [customFor()] : []), key: (id) => "x:" + id }, (_, key) =>
        FloatingAt(key.slice(2), CustomSnooze(key.slice(2)))),
    ]),
  ])
);
