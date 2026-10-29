// The digest: what the gateway did over a window, read from the same
// usage log the alerts scan. Sessions, agents, providers, models, tokens
// and credits — the numbers a user forwards to themselves to see the shape
// of their own usage. Nothing here identifies conversation content; a
// session appears as its id's first eight characters.
//
// readDigest(opts, now) returns the digest for the window ending now and
// saves the cursor, so the next digest covers only what came after — the
// same byte-offset walk the alerts use, one cursor for both.

import { readFileSync, renameSync, writeFileSync, mkdirSync, openSync, readSync, closeSync, statSync } from "node:fs"
import { paths } from "./paths.js"

// paths is the one shared rule (see paths.js): the digest used to keep
// its own copy, which read XDG_CONFIG_DIR — a variable magpie never
// reads — and honoured no portable install, so on those machines the
// digest and the alerts read different folders' logs.

// init loads or plants the shared state file. The digest keeps its own
// cursor (digestOffset) in the same file the alerts use — two walkers, one
// file, neither disturbs the other's offset.
function loadState(p) {
  try {
    const raw = JSON.parse(readFileSync(p.state, "utf8"))
    if (raw && typeof raw === "object") return raw
  } catch {}
  return {}
}

function saveState(p, state) {
  try {
    mkdirSync(p.dir, { recursive: true })
    const tmp = p.state + ".tmp"
    writeFileSync(tmp, JSON.stringify(state))
    renameSync(tmp, p.state)
  } catch {}
}

// baseline plants the digest cursor at the log's current end, so the
// first report covers usage from install onward, not a replay of every
// row before it. Called once by the hook on first sight of report hours.
export function baselineDigest() {
  const p = paths()
  const state = loadState(p)
  if (Number.isFinite(Number(state.digestOffset))) return // already set
  let size = 0
  try {
    size = statSync(p.usage).size
  } catch {}
  state.digestOffset = size
  saveState(p, state)
}

// listed is whether provider is one the user asked for: an empty list is
// every provider, a non-empty one only those on it (the same rule the
// alerts use in watch.js).
function listed(list, provider) {
  if (!Array.isArray(list) || !list.length) return true
  return list.includes(provider)
}

// short is a session id as the mail shows it: first 8 chars — enough to
// tell sessions apart, not enough to mean anything to anyone else.
function short(id) {
  return String(id ?? "").slice(0, 8)
}

// empty returns the digest skeleton: per-agent, per-provider and
// per-model tables plus a sessions map.
function emptyDigest() {
  return { rows: 0, ok: 0, failed: 0, credits: 0, tokensIn: 0, tokensOut: 0, agents: {}, providers: {}, models: {}, sessions: {} }
}

export function readDigest(opts, now = Date.now()) {
  const p = paths()
  const state = loadState(p)
  let offset = Number(state.digestOffset)
  if (!Number.isFinite(offset) || offset < 0) offset = 0
  let size = 0
  try {
    size = statSync(p.usage).size
  } catch {
    return { digest: emptyDigest(), since: now }
  }
  const rows = []
  const buf = Buffer.alloc(Math.max(0, size - offset))
  let fh
  try {
    fh = openSync(p.usage, "r")
    readSync(fh, buf, 0, buf.length, offset)
  } catch {
    return { digest: emptyDigest(), since: now }
  } finally {
    if (fh !== undefined) try { closeSync(fh) } catch {}
  }
  const cut = buf.lastIndexOf(0x0a)
  if (cut < 0) return { digest: emptyDigest(), since: now }
  const text = buf.subarray(0, cut + 1).toString("utf8")
  const end = offset + cut + 1
  for (const line of text.split("\n")) {
    if (!line) continue
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    // the digest honours the same provider list the alerts do: a user
    // who allow-listed providers mails only those providers' usage, not
    // the whole gateway's. An empty list is every provider. Filtered-out
    // rows are still consumed — the window covers a span of time, and a
    // row left for a later digest would double-count.
    if (!listed(opts?.providers, r.provider)) continue
    rows.push(r)
  }
  const d = emptyDigest()
  const seen = {}
  for (const r of rows) {
    d.rows++
    if (typeof r.status === "number" && r.status >= 400) d.failed++
    else d.ok++
    d.credits += Number(r.credits) || 0
    d.tokensIn += Number(r.in) || 0
    d.tokensOut += Number(r.out) || 0
    const a = r.agent || "(none)"
    d.agents[a] = (d.agents[a] || 0) + 1
    const pv = r.provider || "(none)"
    d.providers[pv] = (d.providers[pv] || 0) + 1
    const m = r.model || "(none)"
    d.models[m] = (d.models[m] || 0) + 1
    const sid = short(r.session)
    if (sid) {
      const s = (seen[sid] = seen[sid] || { rows: 0, agents: {} })
      s.rows++
      s.agents[a] = (s.agents[a] || 0) + 1
    }
  }
  d.sessions = seen
  const next = loadState(p)
  next.digestOffset = end
  saveState(p, next)
  return { digest: d, since: end }
}
