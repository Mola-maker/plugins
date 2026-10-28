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

// one mail at a time, however many exchanges finish together
let queue = Promise.resolve()
// the exchange that armed the scan; a second one inside the wait rearms it
let timer = null

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
