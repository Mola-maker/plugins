// Tests for mail-watch: the template, the SMTP client against fake
// servers, and the watch (usage-log scan, quota scan, cooldown). Everything
// runs in a temp config dir (MAGPIE_CONFIG_DIR); the real folder is never
// touched.

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import net from "node:net"
import { execFileSync } from "node:child_process"

const dir = mkdtempSync(join(tmpdir(), "mail-watch-test-"))
process.env.MAGPIE_CONFIG_DIR = dir
mkdirSync(join(dir, "magpie"), { recursive: true })

const watch = await import("./watch.js")
const { fill, message, renderHtml, DEFAULT_HTML } = await import("./template.js")
const { send, resolveSmtp, PRESETS } = await import("./smtp.js")

// ---- the fake SMTP servers ---------------------------------------------
// Two shapes, matching what the client speaks:
//   plain (startPlain) — a net server for the relay tests; records every
//     command and the DATA body.
//   secure (startSecure) — Bun's own TLS listener (implicit TLS, the 465
//     shape). Bun's client-side STARTTLS upgrade does not survive against
//     a Node TLSSocket on every platform (handshake completes, the session
//     dies seconds later), so STARTTLS is not part of the client; the
//     secure tests run against the transport it actually uses. A
//     self-signed certificate made by openssl; a machine without it skips
//     the TLS tests.
let server, got

const cert = { key: null, cert: null }
try {
  const p = join(dir, "key.pem"), c = join(dir, "cert.pem")
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", p, "-out", c, "-days", "1", "-nodes", "-subj", "/CN=localhost"], { stdio: "ignore" })
  cert.key = readFileSync(p)
  cert.cert = readFileSync(c)
} catch {}

// smtpBrain is the dialog both servers speak: greeting, answers per
// command, DATA collected until ".", QUIT ends.
function smtpBrain(answers = {}) {
  got = { commands: [], body: "", bodyInData: false }
  return {
    open(s) {
      s.write("220 fake ready\r\n")
    },
    data(s, d) {
      const text = d.toString("utf8")
      if (got.bodyInData) {
        got.body += text
        if (text.endsWith("\r\n.\r\n")) {
          got.bodyInData = false
          s.write("250 queued\r\n")
        }
        return
      }
      for (const line of text.split("\r\n").filter(Boolean)) {
        got.commands.push(line)
        if (line === "DATA") {
          got.bodyInData = true
          s.write("354 go\r\n")
        } else if (line === "QUIT") {
          s.write("221 bye\r\n")
          setTimeout(() => s.end(), 20) // let the 221 land before the FIN
        } else if (/^AUTH PLAIN/.test(line)) {
          s.write(answers.auth ?? "235 ok\r\n")
        } else if (answers.failRcpt && /^RCPT/.test(line)) {
          s.write("550 no such user\r\n")
        } else if (answers.failMailFrom && /^MAIL/.test(line)) {
          s.write("503 bad sender\r\n")
        } else {
          s.write("250 ok\r\n")
        }
      }
    },
  }
}

function startPlain(answers = {}) {
  const brain = smtpBrain(answers)
  // a net socket speaks the same .write/.end the brain's Bun-style
  // handlers call, so the one dialog serves both servers
  server = net.createServer((s) => {
    brain.open(s)
    s.on("data", (d) => brain.data(s, d))
  })
  return new Promise((res) => server.listen(0, "127.0.0.1", () => res(server.address().port)))
}

function startSecure(answers = {}) {
  if (!cert.cert) return Promise.resolve(null)
  const brain = smtpBrain(answers)
  server = Bun.listen({
    hostname: "127.0.0.1", port: 0,
    tls: { key: cert.key, cert: cert.cert },
    socket: brain,
  })
  return Promise.resolve(server.port)
}

// ---- template ------------------------------------------------------------
describe("template", () => {
  test("fill replaces {{name}} and leaves unknown braces", () => {
    expect(fill("a {{x}} b {{y}} c {{x}}", { x: "1" })).toBe("a 1 b  c 1")
    expect(fill("keep {{not a var}}", {})).toBe("keep {{not a var}}")
    expect(fill("{{missing}}", {})).toBe("")
  })

  test("message builds RFC 5322 headers and a base64 body", () => {
    const m = message({ from: "magpie@example.com", to: ["a@b.c"], subject: "s", body: "hi" })
    expect(m).toContain("From: magpie@example.com\r\n")
    expect(m).toContain("To: a@b.c\r\n")
    expect(m).toContain("Subject: s\r\n")
    expect(m).toContain('Content-Type: text/plain; charset="utf-8"\r\n')
    expect(m.endsWith(Buffer.from("hi").toString("base64") + "\r\n")).toBe(true)
  })

  test("message encodes a non-ASCII subject as RFC 2047 and a display name", () => {
    const m = message({ from: "喵喵 <me@example.com>", to: ["you@example.com"], subject: "额度用尽", body: "x" })
    expect(m).toContain("Subject: =?UTF-8?B?")
    expect(m).toContain("From: =?UTF-8?B?")
    expect(m).toContain("<me@example.com>")
  })

  test("word splits long encoded subjects at the RFC 2047 limit", () => {
    const m = message({ from: "f@x.y", to: ["t@x.y"], subject: "很长的主题".repeat(20), body: "x" })
    for (const line of m.split("\r\n")) {
      // each encoded word stays within RFC 2047 §2's 75 characters, and a
      // folded continuation line (the leading space) stays short
      if (line.startsWith("Subject:")) expect(line.length).toBeLessThanOrEqual(998)
      else if (line.startsWith(" =?")) {
        expect(line.length).toBeLessThanOrEqual(76)
        expect(line.trim().length).toBeLessThanOrEqual(75)
      }
    }
  })

  test("every encoded word decodes on its own (whole codepoints, valid base64)", () => {
    // the failure mode this locks down: slicing the base64 at a fixed
    // width cuts quads mid-way, and each word decodes to shifted garbage
    const subjects = ["很长的主题".repeat(20), "[magpie] 额度用尽 · provider-account-with-a-long-name", "emoji 😀 mixed 中文 text"]
    for (const s of subjects) {
      const m = message({ from: "f@x.y", to: ["t@x.y"], subject: s, body: "x" })
      const line = m.split("\r\n").filter((l) => l.startsWith("Subject:") || l.startsWith(" =?")).join(" ")
      const joined = line.replace(/^Subject: /, "").replace(/ \r?\n /g, "").replace(/ /g, "")
      const out = [...joined.matchAll(/=\?UTF-8\?B\?(.+?)\?=/g)].map((w) => Buffer.from(w[1], "base64").toString("utf8")).join("")
      expect(out).toBe(s)
    }
  })

  test("addr keeps a display name with specials quoted", () => {
    const m = message({ from: '"Acme, Inc." <a@b.c>', to: ["t@x.y"], subject: "s", body: "x" })
    expect(m).toContain('From: "Acme, Inc." <a@b.c>')
  })

  test("addr keeps an injected name on one line, as quoted text", () => {
    // the CRLF is gone, so nothing becomes a header of its own; what the
    // attacker wrote remains inside the quoted display name
    const m = message({ from: 'bad\r\nBcc: x@y.z <a@b.c>', to: ["t@x.y"], subject: "s", body: "x" })
    expect(m.split("\r\n")[0]).toBe('From: "bad Bcc: x@y.z" <a@b.c>')
    for (const line of m.split("\r\n")) expect(line.startsWith("Bcc:")).toBe(false)
  })

  test("message with html is multipart/alternative and both parts decode", () => {
    const m = message({ from: "f@x.y", to: ["t@x.y"], subject: "s", body: "plain", html: "<p>rich</p>" })
    expect(m).toContain('Content-Type: multipart/alternative; boundary="')
    const boundary = /boundary="([^"]+)"/.exec(m)[1]
    expect(m).toContain(`--${boundary}`)
    expect(m.endsWith(`--${boundary}--\r\n\r\n`)).toBe(true)
    // the plain part decodes to the text, the html part to the layout
    const parts = m.split(`--${boundary}`).slice(1, -1)
    const plain = Buffer.from(parts[0].split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8")
    const rich = Buffer.from(parts[1].split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8")
    expect(plain).toBe("plain")
    expect(rich).toBe("<p>rich</p>")
  })

  test("renderHtml escapes vars into the user's layout and fills the default card", () => {
    // an error's words stay text in the user's own page
    const out = renderHtml("<b>{{err}}</b>", { err: "<script>alert(1)</script>", provider: "p", time: "t" })
    expect(out).toContain("&lt;script&gt;")
    expect(out).not.toContain("<script>")
    // the default card fills every slot and leaves no skeleton rows
    const card = renderHtml("", { kind: "error", provider: "p1", account: "", model: "m1", agent: "a1", window: "", used: "", time: "t", detail: "boom" })
    expect(card).toContain("p1")
    expect(card).toContain("m1")
    expect(card).not.toContain("{{modelRow}}")
    expect(card).not.toContain("{{windowRow}}")
  })

  test("resolveSmtp applies a preset under explicit options", () => {
    expect(resolveSmtp({ preset: "qq", user: "u" })).toEqual({ host: "smtp.qq.com", port: 465, secure: true })
    expect(resolveSmtp({ preset: "GMAIL" })).toEqual({ host: "smtp.gmail.com", port: 465, secure: true })
    // a hand-set host and port win; an unknown preset is ignored
    expect(resolveSmtp({ preset: "qq", host: "relay.lan", port: 2525 })).toEqual({ host: "relay.lan", port: 2525, secure: true })
    expect(resolveSmtp({ preset: "nope", host: "relay.lan" })).toEqual({ host: "relay.lan", port: 587, secure: false })
    expect(Object.keys(PRESETS)).toContain("163")
  })
})

// ---- smtp ------------------------------------------------------------------
describe("smtp", () => {
  test("send walks the handshake over implicit TLS and delivers the body", async () => {
    const port = await startSecure()
    if (!port) return // no openssl on this machine
    const body = message({ from: "f@x.y", to: ["t@x.y"], subject: "s", body: "hello" })
    const r = await send({ host: "127.0.0.1", port, secure: true, user: "u", pass: "p", from: "f@x.y", insecure: true }, ["t@x.y"], body)
    expect(r.startsWith("250")).toBe(true)
    expect(got.commands).toEqual([
      "EHLO magpie", "AUTH PLAIN " + Buffer.from("\0u\0p").toString("base64"),
      "MAIL FROM:<f@x.y>", "RCPT TO:<t@x.y>", "DATA", "QUIT",
    ])
    expect(got.body).toContain(Buffer.from("hello").toString("base64"))
    expect(got.body.endsWith("\r\n.\r\n")).toBe(true)
  })

  test("a plain port with a user refuses to send the password", async () => {
    const port = await startPlain()
    const body = message({ from: "f@x.y", to: ["t@x.y"], subject: "s", body: "x" })
    expect(send({ host: "127.0.0.1", port, user: "u", pass: "p" }, ["t@x.y"], body)).rejects.toThrow(/cleartext/)
  })

  test("a plain relay with no user sends fine", async () => {
    const port = await startPlain()
    const body = message({ from: "f@x.y", to: ["t@x.y"], subject: "s", body: "x" })
    const r = await send({ host: "127.0.0.1", port, from: "f@x.y" }, ["t@x.y"], body)
    expect(r.startsWith("250")).toBe(true)
    expect(got.commands).toContain("MAIL FROM:<f@x.y>")
  })

  test("a refused AUTH (535) fails the send", async () => {
    const port = await startSecure({ auth: "535 no\r\n" })
    if (!port) return
    const body = message({ from: "f@x.y", to: ["t@x.y"], subject: "s", body: "x" })
    expect(send({ host: "127.0.0.1", port, secure: true, user: "u", pass: "p", insecure: true }, ["t@x.y"], body)).rejects.toThrow("535")
  })

  test("a refused MAIL FROM (503) fails the send", async () => {
    const port = await startPlain({ failMailFrom: true })
    const body = message({ from: "f@x.y", to: ["t@x.y"], subject: "s", body: "x" })
    expect(send({ host: "127.0.0.1", port, from: "f@x.y" }, ["t@x.y"], body)).rejects.toThrow("503")
  })

  test("send rejects on a refused recipient", async () => {
    const port = await startPlain({ failRcpt: true })
    const body = message({ from: "f@x.y", to: ["t@x.y"], subject: "s", body: "x" })
    expect(send({ host: "127.0.0.1", port, from: "f@x.y" }, ["t@x.y"], body)).rejects.toThrow("550")
  })

  test("send refuses a host that never answers", async () => {
    const body = message({ from: "f@x.y", to: ["t@x.y"], subject: "s", body: "x" })
    expect(send({ host: "127.0.0.1", port: 1, from: "f@x.y" }, ["t@x.y"], body, { timeoutMs: 800 })).rejects.toThrow()
  })
})

// ---- watch -------------------------------------------------------------------
describe("watch", () => {
  const usage = join(dir, "magpie", "usage.jsonl")
  const state = join(dir, "magpie", "mail-watch-state.json")

  beforeAll(() => {
    writeFileSync(usage, "")
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const opts = (over = {}) => ({ watch: { errors: true, ...over }, cooldown: { error: 0, quota: 0 } })

  test("first init takes the log's size as its start, then sees new rows", () => {
    writeFileSync(usage, JSON.stringify({ provider: "old", status: 500 }) + "\n")
    watch.forTests(null)
    watch.init()
    const base = watch.forTests().offset
    expect(base).toBe(Buffer.byteLength(JSON.stringify({ provider: "old", status: 500 }) + "\n"))
    // a new failure arrives
    const row = { provider: "p1", status: 500, err: "boom", err_type: "server_error", model: "m", agent: "a" }
    writeFileSync(usage, readFileSync(usage, "utf8") + JSON.stringify(row) + "\n")
    const r = watch.fail(opts(), 1000)
    expect(r.events).toHaveLength(1)
    expect(r.events[0]).toMatchObject({ kind: "error", provider: "p1", status: 500, err: "boom" })
    expect(r.offset).toBe(base + Buffer.byteLength(JSON.stringify(row) + "\n"))
  })

  test("handed_on rows and successes are skipped; a final failure fires", () => {
    const rows = [
      JSON.stringify({ provider: "p1", status: 429, handed_on: true }) + "\n",
      JSON.stringify({ provider: "p2", status: 200 }) + "\n",
      JSON.stringify({ provider: "p3", status: 401, err_type: "auth" }) + "\n",
    ].join("")
    writeFileSync(usage, readFileSync(usage, "utf8") + rows)
    const r = watch.fail(opts(), 2000)
    expect(r.events).toHaveLength(1)
    expect(r.events[0].provider).toBe("p3")
  })

  test("the user's cooldownMinutes option is honoured (not just the default)", () => {
    const row = JSON.stringify({ provider: "popt", status: 500 }) + "\n"
    const add = () => writeFileSync(usage, readFileSync(usage, "utf8") + row)
    add()
    // 1 minute: the second scan inside a minute is held, past it fires
    const cool = { watch: { errors: true }, cooldown: { error: 1 } }
    const r1 = watch.fail(cool, 60_000)
    expect(r1.events).toHaveLength(1)
    add()
    expect(watch.fail(cool, 90_000)).toEqual({ events: [], offset: watch.forTests().offset })
    add()
    expect(watch.fail(cool, 121_000).events).toHaveLength(1)
  })

  test("cooldown holds a repeat back and fires again after its window", () => {
    const row = JSON.stringify({ provider: "pc", status: 500 }) + "\n"
    const add = () => writeFileSync(usage, readFileSync(usage, "utf8") + row)
    add()
    const cool = { watch: { errors: true }, cooldown: { error: 10 } }
    const r1 = watch.fail(cool, 10_000)
    expect(r1.events).toHaveLength(1)
    add()
    const r2 = watch.fail(cool, 20_000)
    expect(r2.events).toHaveLength(0)
    add()
    const r3 = watch.fail(cool, 10_000 + 11 * 60_000)
    expect(r3.events).toHaveLength(1)
  })

  test("the provider list filters, an empty one lets all through", () => {
    const rows = [
      JSON.stringify({ provider: "a1", status: 500 }) + "\n",
      JSON.stringify({ provider: "b2", status: 500 }) + "\n",
    ].join("")
    writeFileSync(usage, readFileSync(usage, "utf8") + rows)
    const r = watch.fail({ watch: { errors: true, providers: ["b2"] }, cooldown: { error: 0 } }, 5000)
    expect(r.events.map((e) => e.provider)).toEqual(["b2"])
  })

  test("a log cut shorter than the offset restarts the scan", () => {
    writeFileSync(usage, "x")
    const r = watch.fail(opts(), 6000)
    expect(r.offset).toBe(0) // "x" holds no full line: the byte stays unread
    watch.forTests({ offset: 10 ** 9 }) // beyond any size
    const r2 = watch.fail(opts(), 6000)
    expect(r2.offset).toBe(0) // restarted; nothing scanned
    writeFileSync(usage, "")
    watch.forTests({ offset: 0 })
  })

  test("a byte that is not UTF-8 does not push the offset past a row", () => {
    // a row with a broken byte, then a good failing row after it
    const broken = Buffer.from(JSON.stringify({ provider: "pb", status: 200 }) + "\n")
    broken[5] = 0xff
    const good = Buffer.from(JSON.stringify({ provider: "pg", status: 503, err_type: "t" }) + "\n")
    writeFileSync(usage, Buffer.concat([broken, good]))
    const r = watch.fail(opts(), 6500)
    expect(r.events).toHaveLength(1)
    expect(r.events[0].provider).toBe("pg")
    expect(r.offset).toBe(broken.length + good.length)
    writeFileSync(usage, "")
    watch.forTests({ offset: 0 })
  })

  test("state saves and reloads", () => {
    watch.forTests({ offset: 1234, sent: { "error|p|500": 42 } })
    watch.save()
    const raw = JSON.parse(readFileSync(state, "utf8"))
    expect(raw.offset).toBe(1234)
    const st = watch.forTests()
    expect(st.sent["error|p|500"]).toBe(42)
  })

  test("quotaScan reports exhausted and low windows, each its own cooldown", () => {
    writeFileSync(
      join(dir, "magpie", "quotas.json"),
      JSON.stringify({
        "prov|me@example.com": { at: "t", quota: { windows: [{ name: "5 hours", used: 100 }, { name: "7 days", used: 92 }] } },
        "other|u": { quota: { windows: [{ name: "w", used: 55 }] } },
      }),
    )
    const o = { watch: { quotaExhausted: true, quotaLow: true, quotaLowPct: 90 }, cooldown: { quota: 0 } }
    const ev = watch.quotaScan(o, 7000)
    expect(ev.map((e) => e.kind + ":" + e.window)).toEqual(["quotaExhausted:5 hours", "quotaLow:7 days"])
    // same again with a long cooldown: nothing — but the low and exhausted
    // keys are apart, so a window that goes 92→100 still alerts. The sent
    // map starts clean here: the scan above (cooldown 0) marked it already.
    watch.forTests({ sent: {} })
    const cool = { watch: { quotaExhausted: true, quotaLow: true, quotaLowPct: 90 }, cooldown: { quota: 240 } }
    const w1 = watch.quotaScan(cool, 7100)
    expect(w1.map((e) => e.kind)).toEqual(["quotaExhausted", "quotaLow"])
    expect(watch.quotaScan(cool, 7101)).toEqual([])
  })

  test("quotaScan skips unlisted providers and unconfigured kinds", () => {
    const o = { watch: { quotaExhausted: true, providers: ["other"] }, cooldown: { quota: 0 } }
    const ev = watch.quotaScan(o, 8000)
    expect(ev).toEqual([]) // prov|me is not listed
  })

  test("save writes atomically and leaves no temp file", () => {
    watch.save()
    expect(existsSync(state + ".tmp")).toBe(false)
    expect(existsSync(state)).toBe(true)
  })
})
