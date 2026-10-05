const AUTO_SETTLE_AFTER_DAYS = 3; // null = never
const AUTO_SETTLE_ON_MERGE = true; // closed PRs always settle
const SLEEP_SETTLED = true; // settled threads exit Claude; opening one resumes it
const SETTLED_PAGE = 10;
const SETTLED_STEP = 25;
const NOTICE_SECONDS = 5;
const NOTICE_H = 36;

const INFO = "#3b82f6";
const SUCCESS = "#10b981";
const WARNING = "#f59e0b";
const INPUT = "#6366f1";
// The sidebar can't tell light from dark mode.
const APPEARANCE = "light"; // "light" | "dark"
const PALETTE = {
  light: {
    rowActive: "#FFFFFF",
    rowHover: "#FCFCFC",
    border: "#E4E4E7",
    fg: "#27272A",
    muted: "#71717A",
    faint: "#71717A99",
    control: "#71717A1F",
  },
  dark: {
    rowActive: "#FFFFFF0A",
    rowHover: "#FFFFFF0A",
    border: "#FFFFFF0F",
    fg: "#F5F5F5",
    muted: "#8C8C8C",
    faint: "#8C8C8C99",
    control: "#FFFFFF14",
  },
}[APPEARANCE];
const PR_COLORS = { open: "#10b981", closed: "#ef4444", merged: "#8b5cf6" };
// Every pair is at least 0.1 apart in OKLab, so they stay distinct at badge
// size. Near neighbours (amber/yellow, sky/blue, pink/rose) look the same.
const PROJECT_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#84cc16", "#10b981",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#d946ef", "#ec4899",
];

const SETTLED = "Settled";
const CARD_H = 78;
const SLIM_H = 36;
const HEADER_H = 32;
const ROW_GAP = 2;
const SHELVES_TOP = 8;
const SNOOZE_RE = /^Snoozed · .* · #(\d+)$/;

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
// Relative labels only need the minute, so they read this instead of now()
// and don't re-run every second.
let minuteMemo = null; // defined with the other memos below
const nowMinute = () => (minuteMemo ? minuteMemo() * 60 : now());
function relative(t) {
  if (!t) return "";
  const d = nowMinute() - t;
  if (d < 60) return "now";
  if (d < 3600) return Math.floor(d / 60) + "m";
  if (d < 86400) return Math.floor(d / 3600) + "h";
  return Math.floor(d / 86400) + "d";
}
function duration(s) {
  s = Math.max(0, Math.floor(s));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h " + (m % 60) + "m";
}
function countdown(until) {
  const d = until - nowMinute();
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

// A project's label is its folder name, plus parent folders only when another
// project shares that name.
const pathSegments = (dir) => String(dir ?? "").split("/").filter(Boolean);
const baseName = (dir) => pathSegments(dir).pop() ?? "";
// The home folder isn't a project: threads there are "No project".
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
function projectColor(dir) {
  let h = 0x811c9dc5;
  for (const ch of String(dir ?? "")) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193);
  return PROJECT_COLORS[(h >>> 0) % PROJECT_COLORS.length];
}

const all = () => data.workspaces() ?? [];
const groups = () => data.groups() ?? [];

// cmux re-sends the whole workspace list on any change. Each workspace gets
// its own signal that only fires when its data changed, so only that card's
// bindings re-run.
const wsSignals = new Map();
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
const homeMemo = memo(() => {
  for (const w of all()) {
    const m = /^\/Users\/[^/]+/.exec(w.directory ?? "");
    if (m) return m[0];
  }
  return null;
});
// cmux reports both a real request and Claude Code's "waiting for your input"
// idle reminder (about a minute after a reply) as needs_input. A real request
// arrives while the agent is working, the reminder after it went idle, so the
// transition decides. A session first seen already in needs_input (sidebar
// reloaded, cmux restarted) counts as the reminder. Nothing else tells them
// apart (latestMessage is your prompt, not cmux's).
const prevRaw = new Map();
const inputClass = new Map();
function isRealInput(a) {
  const since = a.sinceEpoch ?? 0;
  const known = inputClass.get(a.id);
  if (known && known.since === since) return known.real;
  const prev = prevRaw.get(a.id);
  if (prev === "working") return true;
  if (prev === "needs_input" && known) return known.real; // same wait, re-stamped
  return false;
}
// Claude Code puts its state in the terminal title: ◐/◑ while a turn runs, ✳
// otherwise. cmux only learns that a turn ended from the Stop hook, which Claude
// Code skips when you interrupt it (Esc), so cmux reports "working" until your
// next prompt. While the agent's tab shows Claude's own title, its ✳ wins. A tab
// cmux renamed (auto-naming, a manual rename) hides it and keeps cmux's status.
const CLAUDE_IDLE_TITLE = /^✳(\s|$)/;
function isWorking(w, a) {
  if (a.status !== "working") return false;
  if (!String(a.kind ?? "").toLowerCase().includes("claude")) return true;
  const tab = a.panelId && (w?.tabs ?? []).find((t) => t.id === a.panelId);
  return !(tab && CLAUDE_IDLE_TITLE.test(tab.title ?? ""));
}
function agentState(w) {
  const agents = w?.agents ?? [];
  if (agents.some((a) => a.status === "needs_input" && isRealInput(a))) return "input";
  if (agents.some((a) => isWorking(w, a))) return "working";
  return null;
}
// cmux restarts sinceEpoch on every prompt, including one you send to steer a
// running turn, so "Working" counts from the start of the unbroken run instead.
// A gap of a few seconds still counts as the same run: a message queued while
// Claude works can start its own turn right after the Stop.
const STEER_GAP = 3;
const runStart = new Map(); // agent id -> { start, seen }
function trackRun(w, a, t) {
  if (!isWorking(w, a)) return;
  const known = runStart.get(a.id);
  const start = known && t - known.seen <= STEER_GAP ? known.start : sec(a.sinceEpoch ?? a.lastActivityAt ?? t);
  runStart.set(a.id, { start, seen: t });
}
function workingSince(w) {
  const a = (w?.agents ?? []).find((x) => isWorking(w, x));
  if (!a) return now();
  return runStart.get(a.id)?.start ?? sec(a.sinceEpoch ?? a.lastActivityAt ?? now());
}
// Claude Code / Codex put a spinner glyph and a generic name ("✳ Claude Code")
// in the terminal title; a real title there (a topic Claude Code set, or your
// own rename) still wins.
const TITLE_GLYPHS = /^[\s\u2722-\u273D\u00B7*\u2800-\u28FF\u2022\u25CF\u25D0-\u25D3\u23FA]+/u;
const GENERIC_TITLE = /^(claude( code)?|codex|openai codex|zsh|bash|fish|sh|login|~|~?\/.*)$/i;
const SHELL_TITLE = /^\S+@\S+:/;
// Sessions still running (cmux keeps ended ones around after you quit the agent).
const liveAgents = (w) => (w?.agents ?? []).filter((a) => a.status !== "ended");
function agentKind(w) {
  // A sleeping thread keeps its mark: opening it starts Claude again.
  const a = liveAgents(w)[0] ?? (markerFields(w).slept ? claudeAgent(w) : undefined);
  const k = String(a?.kind ?? "").toLowerCase();
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

// Actions flip local state at once; overrides clear themselves once cmux's
// data (refreshed about once a second) agrees, or after 10s.
const [tick, setTick] = signal(0);
const bump = () => setTick(tick() + 1);
const shelfOverride = new Map();
const woke = new Map();
const snoozedWhileWorking = new Set();
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
const pendingDesc = new Map();
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
// Zero/empty fields are dropped; {} or null removes the marker (and the
// description, if nothing else was in it).
function writeMarker(id, fields) {
  const w = byId(id);
  const current = descriptionOf(w);
  // A sleeping thread stays asleep whatever else changes, until it's woken.
  const { slept, pid } = markerFields(w);
  if (slept && !(fields && "slept" in fields)) fields = { ...fields, slept, pid };
  const base = current.replace(MARKER_RE, "");
  const parts = Object.entries(fields ?? {})
    .filter(([k, v]) => k !== "legacy" && v)
    .map(([k, v]) => k + "=" + Math.floor(v));
  const next = parts.length ? (base ? base + "\n" : "") + "[t3 " + parts.join(" ") + "]" : base;
  // No bump() here: shelf changes re-render themselves, and bumping on every
  // prompt-time save re-checked every card.
  setDescription(id, current, next);
}
function setDescription(id, current, next) {
  if (next === current) return;
  pendingDesc.set(id, { desc: next, at: now() });
  if (next) cmux("workspace.action", { action: "set_description", workspace_id: id, description: next });
  else cmux("workspace.action", { action: "clear_description", workspace_id: id });
}

// Favorite projects are "[t3:fav <dir>]" lines just above the marker. The
// sidebar has nowhere else to keep them, so every workspace carries the whole
// list: a favorite outlives its own project's threads.
const FAV_RE = /^\[t3:fav (.+)\]$/;
function favLines(w) {
  return descriptionOf(w).split("\n").map((l) => FAV_RE.exec(l)?.[1]).filter(Boolean).sort();
}
function writeFavorites(w, dirs) {
  const current = descriptionOf(w);
  const m = MARKER_RE.exec(current);
  const base = (m ? current.slice(0, m.index) : current).split("\n").filter((l) => !FAV_RE.test(l)).join("\n");
  const next = [base, ...dirs.map((d) => "[t3:fav " + d + "]"), m ? m[0].trim() : ""].filter(Boolean).join("\n");
  setDescription(w.id, current, next);
}
const favorites = memo(() => {
  tick();
  const dirs = new Set();
  for (const w of all()) if (!isOldHeader(w)) for (const d of favLines(w)) dirs.add(d);
  return Array.from(dirs).sort();
}, (dirs) => dirs.join("\n"));
const isFavorite = (dir) => favorites().includes(dir);
function toggleFavorite(dir) {
  const next = isFavorite(dir) ? favorites().filter((d) => d !== dir) : [...favorites(), dir].sort();
  for (const w of all()) if (!isOldHeader(w)) writeFavorites(w, next);
  bump();
}
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

// No clock read here, so icon/color/dimming bindings don't re-run every
// second; statusText() adds the ticking "Working 12s".
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
function receded(w) {
  if (!w || isSelected(w) || isMulti(w.id)) return false;
  const s = topStatus(w)?.kind;
  if (s === "input") return false;
  if (s === "working") return true;
  if (s === "woke" || s === "done") return false;
  return !((w.unread ?? 0) > 0);
}
const canSnooze = (w) => !!w && agentState(w) !== "input";

const [query, setQuery] = signal("");
const [scope, setScopeRaw] = signal(null);
const [picker, setPicker] = signal(null);
const [pickerQuery, setPickerQuery] = signal("");
const [snoozeMenuFor, setSnoozeMenuFor] = signal(null);
const [customFor, setCustomFor] = signal(null);
const [editingId, setEditingId] = signal(null);
const [settledShown, setSettledShown] = signal(SETTLED_PAGE);
const [snoozedExpanded, setSnoozedExpanded] = signal(false);
const [settledLocalExpanded, setSettledLocalExpanded] = signal(false);
const [notice, setNotice] = signal(null);
const multi = new Set();
let lastClicked = null;

function setScope(dir) {
  setScopeRaw(dir);
  setSettledShown(SETTLED_PAGE);
}
const isMulti = (id) => (tick(), multi.has(id));
const bulkIds = (id) => (multi.has(id) ? Array.from(multi) : [id]);
// Notices show inline where you acted (the sidebar can't pin anything to the
// window's bottom). anchor: { before: id | null } - where a settled/snoozed
// card used to be (null = end of the list); { after: id } - under a card;
// none - list top.
function showNotice(text, undo, anchor, icon, extra) {
  setNotice({ ...extra, text, at: now(), undo, anchor, icon: icon ?? (undo ? "checkmark.circle" : "exclamationmark.circle") });
}

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
function projects() {
  return projectIndex().dirs.map((dir) => ({ dir, name: projectLabel(dir) }));
}
// `keep` stays listed anyway (the filter's current project, so its checkmark
// doesn't vanish).
function activeProjects(keep) {
  const dirs = new Set(all().filter((w) => !isOldHeader(w) && shelfOf(w).shelf === "active").map((w) => w.directory));
  return projects().filter((p) => dirs.has(p.dir) || p.dir === keep);
}
// The new-thread menu also lists favorites, even ones with no thread left, and
// puts them first.
function newThreadProjects() {
  const out = activeProjects();
  for (const dir of favorites()) {
    if (!isHome(dir) && !out.some((p) => p.dir === dir)) out.push({ dir, name: projectLabel(dir) });
  }
  return out.sort((a, b) => isFavorite(b.dir) - isFavorite(a.dir) || a.dir.localeCompare(b.dir));
}
const scopeName = () => (scope() ? projectLabel(scope()) : "");

function matchesSearch(w) {
  const q = query().trim().toLowerCase();
  if (!q) return true;
  if (threadTitle(w).toLowerCase().includes(q) || (w.title ?? "").toLowerCase().includes(q)) return true;
  const n = q.replace(/^#/, "");
  const prs = w.prs ?? (w.pr ? [w.pr] : []);
  return /^\d+$/.test(n) && prs.some((p) => String(p.number).startsWith(n));
}
const visible = memo(() => {
  tick();
  return all().filter((w) => !isOldHeader(w) && (!scope() || w.directory === scope()) && matchesSearch(w));
}, idsKey);
const fresh = (list) => list.map((w) => byId(w.id) ?? w);
const pinnedRows = memo(() => fresh(visible()).filter((w) => shelfOf(w).shelf === "active" && w.pinned), idsKey);
const activeRows = memo(() => fresh(visible()).filter((w) => shelfOf(w).shelf === "active" && !w.pinned), idsKey);
const cardRows = memo(() => fresh([...pinnedRows(), ...activeRows()]), idsKey);
function shelfSortKey(w) {
  const s = shelfOf(w);
  return s.shelf === "snoozed" ? s.until : s.shelf === "settled" ? -(s.at || lastPrompt(w)) : 0;
}
const byShelfKey = (a, b) => shelfSortKey(a) - shelfSortKey(b);
const snoozedRows = memo(() =>
  fresh(visible()).filter((w) => shelfOf(w).shelf === "snoozed").sort(byShelfKey), idsKey);
const settledRows = memo(() =>
  fresh(visible()).filter((w) => shelfOf(w).shelf === "settled").sort(byShelfKey), idsKey);

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
function anchorForRemoval(ids) {
  const cards = cardRows().map((w) => w.id);
  const first = cards.findIndex((id) => ids.includes(id));
  if (first < 0) return undefined;
  const next = cards.slice(first + 1).find((id) => !ids.includes(id));
  return { before: next ?? null };
}
// Settling/snoozing the open thread moves to the next card (wrapping), or,
// when none is left, opens a fresh "No project" thread, not a copy of the one
// just settled.
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
    lastOpen.delete(id); // you're done with it: no grace before it sleeps
    writeMarker(id, { settled: now(), last: lastPrompt(byId(id)) });
  }
  bump();
  if (!auto) {
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
// manual = you did it (un-settle, pin): auto-settle then leaves the thread
// alone for good.
function toActive(ids, manual) {
  for (const id of ids) {
    shelfOverride.set(id, { shelf: "active", at: now() });
    writeMarker(id, { manual: manual ? 1 : 0, last: lastPrompt(byId(id)) });
  }
  bump();
}
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

// Settled threads don't keep Claude running. Once the Undo notice is gone (or,
// for a settled thread you reopened, 10 minutes after you left it), its idle
// Claude is exited (Ctrl+C clears an unsent draft, then /exit). Opening the
// thread starts the same session again with the resume command
// claude-turn-end.sh saved for it (same flags and permission mode). The marker
// remembers it: slept=<when> pid=<the Claude process that was exited>.
const SLEEP_GRACE = 600; // seconds since you last had the thread open
const RESUME_SCRIPT = "~/.config/cmux/claude-turn-end.sh";
const sleepSteps = new Map(); // id -> when Ctrl+C was sent
const lastOpen = new Map(); // id -> when it was last the selected thread
const resumeTyped = new Set();
const claudeAgent = (w) => (w?.agents ?? []).find((a) => String(a.kind ?? "").toLowerCase().includes("claude"));
// The thread's running Claude. cmux doesn't always notice Claude exiting (a
// session still at the folder-trust prompt never reports it), so the process a
// thread was put to sleep from doesn't count, even if cmux still lists it.
function runningClaude(w) {
  const a = claudeAgent(w);
  if (!a || a.status === "ended") return null;
  const f = markerFields(w);
  return f.slept && (!f.pid || f.pid === a.pid) ? null : a;
}
// surface.send_text / send_key take the panel id (a tab's `id`, an agent's
// `panelId`), not the `surfaceId` the sidebar data also carries.
function typeInto(w, panelId, text, enter) {
  cmux("surface.send_text", { workspace_id: w.id, surface_id: panelId, text });
  if (enter) cmux("surface.send_key", { workspace_id: w.id, surface_id: panelId, key: "enter" });
}
function sleepSettled(w, t) {
  const a = runningClaude(w);
  const ready =
    a && a.panelId && agentState(w) === null &&
    !(a.children ?? []).some((c) => c.running) &&
    !shelfOverride.has(w.id) && t - (shelfOf(w).at ?? 0) >= NOTICE_SECONDS + 5 &&
    t - (lastOpen.get(w.id) ?? 0) >= SLEEP_GRACE;
  const ctrlC = sleepSteps.get(w.id);
  if (!ready) {
    sleepSteps.delete(w.id);
  } else if (!ctrlC) {
    typeInto(w, a.panelId, "\u0003");
    sleepSteps.set(w.id, t);
  } else if (t - ctrlC >= 1) {
    typeInto(w, a.panelId, "/exit", true);
    resumeTyped.delete(w.id);
    writeMarker(w.id, { ...markerFields(w), slept: t, pid: a.pid ?? 0 });
    sleepSteps.delete(w.id);
  }
}
function wakeSlept(w) {
  const f = markerFields(w);
  if (!f.slept) return;
  // Running again already (you started it, or cmux restored it).
  if (runningClaude(w)) return writeMarker(w.id, { ...f, slept: 0, pid: 0 });
  if (resumeTyped.has(w.id)) return;
  const a = claudeAgent(w);
  const panelId = a?.panelId ?? (w.tabs ?? []).find((x) => x.directory)?.id;
  if (!panelId) return;
  const id = /^[\w-]+$/.test(a?.id ?? "") ? a.id : "";
  const fallback = id ? "claude --resume " + id : "claude --continue";
  typeInto(w, panelId, `if [ -x ${RESUME_SCRIPT} ]; then ${RESUME_SCRIPT} resume ${id}; else ${fallback}; fi`, true);
  resumeTyped.add(w.id);
  writeMarker(w.id, { ...f, slept: 0, pid: 0 });
}

// One-time migration: earlier versions kept shelves in cmux groups named
// "Settled" and "Snoozed · … · #<epoch>", and cmux spawned a header workspace
// per group. Members get a description marker instead, the groups are
// dissolved, and those header workspaces (group name as title, no agent
// session) are closed.
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

// Cmd+1…9 follow cmux's workspace order, not the sidebar's, so cmux's order
// is kept the same as the sidebar's: open threads (in cmux's order), then
// Snoozed, then Settled. cmux keeps pinned workspaces first, so they're sorted
// the same way among themselves.
const SHELF_RANK = { active: 0, snoozed: 1, settled: 2 };
let orderSent = null;
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

const prevStatus = new Map();
const upgraded = new Set();
let lastSweep = 0;
computed(() => {
  const t = now();
  const ws = all();
  groups();

  migrateOldGroups(ws);

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

  const favs = favorites();
  const favKey = favs.join("\n");
  for (const w of ws) {
    if (!isOldHeader(w) && favLines(w).join("\n") !== favKey) writeFavorites(w, favs);
    for (const a of w.agents ?? []) {
      if (a.status === "needs_input") {
        const since = a.sinceEpoch ?? 0;
        const known = inputClass.get(a.id);
        if (!known || known.since !== since) inputClass.set(a.id, { since, real: isRealInput(a) });
      }
      trackRun(w, a, t);
      prevRaw.set(a.id, a.status);
    }
    const s = agentState(w);
    const prev = prevStatus.get(w.id);
    prevStatus.set(w.id, s);
    const shelf = shelfOf(w);
    const marker = markerOf(w);
    const prompt = w.latestAt ? sec(w.latestAt) : 0;
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
      dismissWoke(w.id);
    }
    if (isSelected(w)) lastOpen.set(w.id, t);
    if (SLEEP_SETTLED) {
      if (isSelected(w)) wakeSlept(w);
      else if (shelf.shelf === "settled") sleepSettled(w, t);
    }
    if (!marker.legacy && prompt > (marker.last || 0) + 1 && !shelfOverride.has(w.id)) {
      writeMarker(w.id, { ...markerFields(w), last: prompt });
    }
  }

  if (t - lastSweep >= 60) {
    lastSweep = t;
    const due = ws.filter((w) => {
      if (shelfOf(w).shelf !== "active" || w.pinned || isSelected(w) || markerOf(w).manual) return false;
      if (agentState(w) !== null) return false;
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

// cmux sends a text field's "submit" both for Return and for focus loss, and
// a click on any other sidebar node blurs the field first (submit, then tap,
// in one host call). So a submit is held until the next clock tick and dropped
// if a tap follows: Return acts, clicking elsewhere doesn't.
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
// For a tap inside a popover that should leave it open. The tap blurred the
// focus catcher, so its close is dropped and a fresh catcher mounts to take
// focus back; without one, clicking the terminal would no longer close it.
const [catcherGen, setCatcherGen] = signal(0);
function keepPopoverOpen() {
  pendingClose = null;
  setBlurred(false);
  setCatcherGen(catcherGen() + 1);
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

function threadMenu(id, shelf) {
  const w = () => byId(id);
  return [
    Button(() => (w()?.branch ? "New thread on " + w().branch : "New thread"), () => newThread(w()?.directory)),
    Button(() => (w()?.pinned ? "Unpin thread" : "Pin thread"), () => {
      const pin = !w()?.pinned;
      for (const x of bulkIds(id)) {
        if (pin && shelfOf(byId(x)).shelf !== "active") toActive([x], true);
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

function when(cond, key, build) {
  return ForEach({ items: () => (cond() ? [key] : []), key: (k) => k }, () => build());
}
function ProjectBadge(dir) {
  const color = () => projectColor(dir());
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
// The sidebar can only draw SF Symbols and text, so these stand in for the
// logos: Claude Code's ✻ glyph and a generic symbol for Codex.
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

// Working rows are dimmed like T3's, but without T3's fade-back on hover:
// that needs every dimmed part drawn twice, which doubled the cost of every
// sidebar update and made scrolling stutter.
function HoverUndim(dimmed, build) {
  return build().opacity(() => (dimmed() ? 0.7 : 1));
}

function ThreadCard(id) {
  const w = () => byId(id);
  const status = memo(() => topStatus(w()), (st) => (st ? st.kind : ""));
  const selected = memo(() => isSelected(w()));
  const dimmed = memo(() => status()?.kind === "working" && !selected() && !isMulti(id));
  const isReceded = memo(() => receded(w()));
  return VStack({ spacing: 0, alignment: "leading" }, [
    HStack({ spacing: 6 }, [
      // cmux splits leftover width between flexible views, so the status slot
      // never shrinks, the project label comes next and the spacer last: nothing
      // truncates while there's room.
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
        HStack({ spacing: 8 }, [
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
    HoverUndim(dimmed, () => Text(() => threadTitle(w()))
      .font(14)
      .weight(() => (isReceded() ? "regular" : "medium"))
      .color(() => (isReceded() ? PALETTE.muted : PALETTE.fg))
      .lineLimit(1)
      .truncation("tail")
      .marquee()).paddingTop(4),
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
      else if (newThreadProjects().length > 0) togglePicker("new");
      else newThread(homeDir() ?? selectedDir);
    }),
  ]).paddingHorizontal(8).paddingVertical(6);
}

function Popover(content) {
  return content
    .padding(4)
    .cornerRadius(10)
    .background("thickMaterial")
    .borderColor("#7f7f7f40")
    .borderWidth(1);
}
// Invisible focus catcher for the open dropdown: it takes keyboard focus when
// the dropdown opens, so clicking the terminal (which sends the sidebar no
// event) blurs it and the dropdown closes. A click on an option arrives right
// after that blur and wins. Esc closes too. It's mounted at the root, not in
// the dropdown: cmux doesn't dispose a row a nested list mounts later, so a
// catcher remounted inside the dropdown (keepPopoverOpen) would outlive it.
const openMenu = () => (picker() ? "p:" + picker() : snoozeMenuFor() ? "m:" + snoozeMenuFor() : null);
function FocusCatcher(menu) {
  const value = menu.slice(2);
  const [isOpen, close] = menu.startsWith("p:")
    ? [() => picker() === value, () => setPicker(null)]
    : [() => snoozeMenuFor() === value, () => setSnoozeMenuFor(null)];
  return TextField("", {
    onSubmit: () => blurClose(() => { if (isOpen()) close(); }),
    onCancel: close,
  }).frame({ width: 1, height: 1 }).opacity(0);
}
function ProjectMenu(mode) {
  const close = () => setPicker(null);
  const choose = (dir) => {
    close();
    if (mode === "new") newThread(dir);
    else setScope(dir);
  };
  // The label column outranks the spacer, or cmux splits the free width between
  // them and truncates names early.
  const item = (children, onTap, trailing) =>
    HStack({ spacing: 8 }, [...children, Spacer({ minLength: 8 }), ...(trailing ? [trailing] : [])])
      .paddingHorizontal(10)
      .paddingVertical(5)
      .cornerRadius(5)
      .hoverBackground("#7f7f7f24")
      .onTap(onTap);
  const check = (on) => Image("checkmark").font(11).weight("semibold").color("secondary").opacity(on ? 1 : 0);
  const star = (dir) =>
    Image(() => (isFavorite(dir) ? "star.fill" : "star"))
      .font(11)
      .color(() => (isFavorite(dir) ? WARNING : "tertiary"))
      .padding(3)
      .cornerRadius(5)
      .hoverBackground(PALETTE.control)
      .help(() => (isFavorite(dir) ? "Remove from favorites" : "Add to favorites (always listed)"))
      .showOnHover(() => !isFavorite(dir))
      .onTap(() => {
        toggleFavorite(dir);
        keepPopoverOpen();
      });
  const label = (title, subtitle) =>
    VStack({ spacing: 0, alignment: "leading" }, [
      Text(title).font(13).lineLimit(1).truncation("tail"),
      Text(subtitle).font(11).color("tertiary").lineLimit(1).truncation("head"),
    ]).layoutPriority(1);
  const home = homeDir();
  const projectRows = (mode === "new" ? newThreadProjects() : activeProjects(scope())).map((p) =>
    item([ProjectBadge(() => p.dir), label(p.name, shortPath(p.dir))],
      () => choose(p.dir), mode === "new" ? star(p.dir) : check(scope() === p.dir)));
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
    if (live.anchor && live.anchor.before === null) out.push(noticeEntry);
    else out.unshift(noticeEntry);
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
  const n = notice();
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
      ForEach({ items: () => (snoozeMenuFor() ? [snoozeMenuFor()] : []), key: (id) => "m:" + id }, (_, key) =>
        FloatingAt(key.slice(2), SnoozeMenu(key.slice(2)))),
      ForEach({ items: () => (customFor() ? [customFor()] : []), key: (id) => "x:" + id }, (_, key) =>
        FloatingAt(key.slice(2), CustomSnooze(key.slice(2)))),
      ForEach({ items: () => (openMenu() ? [{ menu: openMenu(), gen: catcherGen() }] : []), key: (c) => c.menu + "#" + c.gen }, (c) => {
        const id = c().menu.startsWith("m:") ? c().menu.slice(2) : null;
        return FloatingAt(id, FocusCatcher(c().menu), id ? undefined : () => 0);
      }),
    ]),
  ])
);
