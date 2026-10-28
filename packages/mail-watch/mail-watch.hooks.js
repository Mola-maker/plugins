// mail-watch as magpie's asynchronous gateway hooks (package.json
// magpie.hooks): magpie calls onRequest as a request comes in (it must
// return undefined — this plugin changes nothing) and onResponse once an
// exchange with the model is over — the reply the client got, or null with
// success false when the request failed — and this file answers with the
// alerts the user asked for, as mail.
//
// The call is bounded (the gateway gives each hook a second by default and
// moves on), so the hooks kick the work off and return at once: the scan
// of magpie's own logs, then the mail, sent through the queue one
// connection at a time, never awaited here. Nothing they do may throw —
// a broken SMTP must not turn into noise in magpie's log, let alone
// touch the request. The scan waits a moment on purpose: magpie writes
// the call's row as (or after) the reply goes out, and a scan that ran at
// once would read a log that doesn't hold it yet.

import { send } from "./smtp.js"
import { fill, message, renderHtml } from "./template.js"
import { fail, quotaScan, save } from "./watch.js"
import { readDigest, baselineDigest } from "./digest.js"

// one mail at a time, however many exchanges finish together
let queue = Promise.resolve()
// the exchange that armed the scan; a second one inside the wait rearms it
let timer = null
// the digest's due time: the next moment the window closes; 0 = unscheduled
let digestAt = 0
let digestTimer = null

// PAUSE is how long the scan waits after an exchange ends, for the usage
// row to be written: short enough to stay behind the next exchange's own
// scan, long enough that magpie's append lands first.
const PAUSE = 1500

export function onRequest(_body, _ctx) {
  // mail-watch changes nothing a request carries
  return undefined
}

export async function onResponse(_reply, ctx) {
  try {
    const o = ctx?.options
    if (!o || typeof o !== "object") return
    const to = recipients(o.to)
    if (!to.length || !o.smtp?.host) return
    schedule(o, to)
    scheduleDigest(o, to)
  } catch {}
  return
}

// schedule rearms the debounced scan: 1.5 s after the latest exchange, so
// a burst of parallel calls is scanned once, its rows all written.
function schedule(o, to) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    scan(o, to).catch(() => {})
  }, PAUSE)
}

// scheduleDigest arms the periodic usage report: report.hours after the
// last arm (default 6), first due run reads everything since the last
// digest — or, on a fresh install, since now, so the first mail is the
// shape of what happened, not a replay of the whole log. Rearming keeps
// one timer; the window slides rather than stacks.
function scheduleDigest(o, to) {
  const hours = Number(o.report?.hours)
  if (!Number.isFinite(hours) || hours <= 0) return
  const wait = hours * 3_600_000
  const now = Date.now()
  if (!digestAt) baselineDigest() // first sight: report from here on
  digestAt = now + wait
  if (digestTimer) clearTimeout(digestTimer)
  digestTimer = setTimeout(() => {
    digestTimer = null
    digestAt = 0
    sendDigest(o, to).catch(() => {})
    scheduleDigest(o, to) // arm the next window
  }, wait)
}

// sendDigest reads the window's rows and mails the summary through the
// same queue the alerts use.
async function sendDigest(o, to) {
  const { digest } = readDigest({})
  if (!digest.rows) return // an empty window sends nothing
  const t = o.template && typeof o.template === "object" ? o.template : {}
  const vars = digestVars(digest)
  const subject = fill(t.reportSubject ?? "[magpie] 使用摘要 · {{rows}} 次调用 · {{credits}} credits", vars)
  const body = fill(t.reportBody ?? DEFAULT_REPORT_BODY, vars)
  const html = t.html === false ? undefined : renderHtml(t.reportHtml, vars)
  await send(o.smtp, to, message({ from: o.smtp.from ?? o.smtp.user, to, subject, body, html }))
}

// bar is a tiny inline bar for the HTML report: a 100px track with the
// share filled.
function bar(share) {
  const pct = Math.max(0, Math.min(100, Math.round(share)))
  return `<div style="display:inline-block;vertical-align:middle;width:100px;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:#2563eb;"></div></div>`
}

// digestVars renders the digest for the templates: sorted tables as text
// lines for the plain body, rows for the HTML layout.
function digestVars(d) {
  const rows = d.rows || 1
  const table = (counts) => Object.entries(counts).sort((x, y) => y[1] - x[1])
  const agents = table(d.agents)
  const providers = table(d.providers)
  const models = table(d.models)
  const sessions = Object.entries(d.sessions)
  const line = ([k, n]) => `${k} — ${n} 次 (${Math.round((n / rows) * 100)}%)`
  const modelLine = (kv) =>
    kv.map(([k, n]) => `<tr><td style="padding:4px 0;color:#6b7280;">${k}</td><td style="padding:4px 0;">${n} 次 ${bar((n / rows) * 100)} <span style="color:#9ca3af;font-size:12px;">${Math.round((n / rows) * 100)}%</span></td></tr>`).join("")
  return {
    rows: d.rows,
    ok: d.ok,
    failed: d.failed,
    credits: d.credits.toFixed(2),
    tokensIn: d.tokensIn.toLocaleString("en-US"),
    tokensOut: d.tokensOut.toLocaleString("en-US"),
    sessionCount: sessions.length,
    agentList: agents.map(line).join("\n"),
    providerList: providers.map(line).join("\n"),
    modelList: models.map(line).join("\n"),
    sessionList: sessions.slice(0, 20).map(([sid, s]) => `${sid}… (${s.rows} 次调用 · ${Object.keys(s.agents).length} 个 agent)`).join("\n"),
    agentRows: modelLine(agents),
    providerRows: modelLine(providers),
    modelRows: modelLine(models),
    detail: `Calls: ${d.rows} (ok ${d.ok} / failed ${d.failed})\nCredits: ${d.credits.toFixed(2)}\nTokens: ${d.tokensIn.toLocaleString("en-US")} in / ${d.tokensOut.toLocaleString("en-US")} out\nSessions: ${sessions.length}\n\nAgents:\n${agents.map(line).join("\n")}\n\nProviders:\n${providers.map(line).join("\n")}\n\nModels:\n${models.map(line).join("\n")}`,
  }
}

const DEFAULT_REPORT_BODY = `magpie 使用摘要

Calls: {{rows}} (成功 {{ok}} / 失败 {{failed}})
Credits: {{credits}}
Tokens: {{tokensIn}} in / {{tokensOut}} out
Sessions: {{sessionCount}}

Agents:
{{agentList}}

Providers:
{{providerList}}

Models:
{{modelList}}
`

const DEFAULT_REPORT_HTML = `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="padding:16px 24px;background:#1f2937;color:#ffffff;">
      <span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:12px;background:#2563eb;color:#fff;">usage digest</span>
      <span style="margin-left:8px;font-size:14px;color:#d1d5db;">magpie mail-watch</span>
    </div>
    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#111827;margin-bottom:16px;">
        <tr><td style="padding:6px 0;color:#6b7280;width:96px;">Calls</td><td style="padding:6px 0;">{{rows}} <span style="color:#9ca3af;">(ok {{ok}} / failed {{failed}})</span></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Credits</td><td style="padding:6px 0;">{{credits}}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Tokens</td><td style="padding:6px 0;">{{tokensIn}} in / {{tokensOut}} out</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Sessions</td><td style="padding:6px 0;">{{sessionCount}}</td></tr>
      </table>
      <div style="font-size:13px;color:#6b7280;margin:12px 0 4px;">Agents</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#111827;">{{agentRows}}</table>
      <div style="font-size:13px;color:#6b7280;margin:12px 0 4px;">Providers</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#111827;">{{providerRows}}</table>
      <div style="font-size:13px;color:#6b7280;margin:12px 0 4px;">Models</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#111827;">{{modelRows}}</table>
    </div>
    <div style="padding:12px 24px;background:#f9fafb;color:#9ca3af;font-size:12px;">sent by magpie mail-watch from your own gateway</div>
  </div>
</body></html>`

async function scan(o, to) {
  const opts = { watch: o.watch ?? {}, cooldown: o.cooldownMinutes ?? {} }
  const events = [...fail(opts).events, ...quotaScan(opts)]
  if (!events.length) {
    save()
    return
  }
  save()
  for (const ev of events) {
    queue = queue.then(() => mail(o, to, ev)).catch(() => {})
  }
}

// mail renders one event through the user's template and hands it to the
// SMTP client. A failure is swallowed: the next event tries again, the
// cooldown keeps a broken server from collecting a backlog.
async function mail(o, to, ev) {
  const vars = {
    kind: ev.kind === "error" ? "error" : ev.kind === "quotaExhausted" ? "quota exhausted" : "quota low",
    provider: ev.provider,
    account: ev.account ? ` · ${ev.account}` : "",
    model: ev.model ?? "",
    agent: ev.agent ?? "",
    status: ev.status ?? "",
    errType: ev.errType ?? "",
    endpoint: ev.endpoint ?? "",
    window: ev.window ? ` · ${ev.window}` : "",
    used: ev.used ?? "",
    resetsAt: ev.resetsAt ?? "",
    time: new Date().toISOString(),
    modelLine: ev.model ? `Model: ${ev.model}${ev.agent ? ` · ${ev.agent}` : ""}\n` : "",
    windowLine: ev.window ? `Window: ${ev.window} — ${ev.used}% used${ev.resetsAt ? `, resets ${ev.resetsAt}` : ""}\n` : "",
    detail:
      ev.kind === "error"
        ? `Status: ${ev.status}${ev.errType ? ` (${ev.errType})` : ""}\n${ev.endpoint ? `Endpoint: ${ev.endpoint}\n` : ""}${ev.err || "(the vendor said nothing)"}`
        : `${ev.used}% of the window "${ev.window}" is used${ev.resetsAt ? `; it resets at ${ev.resetsAt}` : ""}.`,
  }
  const t = o.template && typeof o.template === "object" ? o.template : {}
  const subject = fill(t.subject ?? "[magpie] {{kind}} · {{provider}}{{window}}", vars)
  const body = fill(t.body ?? "What: {{kind}}\nProvider: {{provider}}{{account}}\n{{modelLine}}{{windowLine}}When: {{time}}\n\n{{detail}}", vars)
  // the HTML layout: the user's own page when they set one (filled with
  // the same vars, HTML-escaped variants for the interpolations), the
  // built-in card otherwise; false opts out of the HTML part entirely
  const html = t.html === false ? undefined : renderHtml(t.html, vars)
  await send(o.smtp, to, message({ from: o.smtp.from ?? o.smtp.user, to, subject, body, html }))
}

// recipients is the option as a list of addresses: a string with commas,
// an array, one address.
function recipients(v) {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []
  return list.map((s) => String(s ?? "").trim()).filter(Boolean)
}
