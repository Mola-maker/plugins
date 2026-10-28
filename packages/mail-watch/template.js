// Template rendering and the MIME message, with nothing to import.
//
// fill replaces {{name}} with vars[name]: a missing name becomes "", a
// value that isn't a string is JSON. Unknown braces are left as they are,
// so a template that means to show an example still does.

export function fill(text, vars) {
  return String(text ?? "").replace(/\{\{([A-Za-z0-9_.-]+)\}\}/g, (_, k) => {
    const v = vars[k]
    if (v === undefined || v === null) return ""
    return typeof v === "string" ? v : JSON.stringify(v)
  })
}

// message builds one RFC 5322 mail as a string: From, To, Subject (UTF-8
// in RFC 2047 words), Date, Message-ID and a base64 text body. Addresses
// go out as given — the user's own options — with the angle form only
// when what was given isn't already one.
export function message({ from, to, subject, body, now = new Date() }) {
  const id = `<${now.getTime()}.${Math.random().toString(36).slice(2)}@magpie-mail-watch>`
  const date = now.toUTCString().replace("GMT", "+0000")
  const lines = [
    `From: ${addr(from)}`,
    `To: ${to.map(addr).join(", ")}`,
    `Subject: ${word(subject ?? "")}`,
    `Date: ${date}`,
    `Message-ID: ${id}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
  ]
  return lines.join("\r\n") + "\r\n" + Buffer.from(body ?? "", "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n") + "\r\n"
}

// addr is one address as the header wants it: bare as given, or the
// display name kept as quoted-text when ASCII with specials (a comma, a
// colon) and RFC 2047 encoded when it holds anything outside ASCII —
// "喵喵 <me@example.com>" and "Acme, Inc." <a@b.c> both survive.
// CR/LF is stripped first: an option is trusted, a header is a protocol.
function addr(a) {
  const s = String(a ?? "").replace(/[\r\n]+/g, " ").trim()
  if (!s) return "<postmaster@localhost>"
  const m = /^(.*)<([^>]*)>\s*$/.exec(s)
  if (!m) return s
  const name = m[1].trim()
  const box = m[2].trim()
  if (!name) return `<${box}>`
  if (/[^\x20-\x7e]/.test(name)) return `${word(name)} <${box}>`
  const quoted = name.replace(/^"|"$/g, "")
  // a name with specials (a comma, a colon) must stay quoted-text —
  // "Acme, Inc." <a@b.c> parsed bare would read as two addresses
  const shown = /[,;:()]/.test(quoted) ? `"${quoted}"` : quoted
  return `${shown} <${box}>`
}

// word is a header value as RFC 2047 encoded-words when it has anything
// outside ASCII, separated by a space-fold so a decoder joins them. Each
// encoded-word must decode on its own: the text is chunked by whole
// codepoints BEFORE encoding — at most 45 UTF-8 bytes a chunk, 60 base64
// characters, an encoded word of 72 — so no codepoint is split across
// words and every chunk's base64 is a valid, self-contained unit. (Slicing
// the base64 itself would cut quads mid-way: 63 is not a multiple of 4,
// and each word would decode to shifted garbage.) CR/LF never survives.
function word(s) {
  const v = String(s ?? "").replace(/[\r\n]+/g, " ")
  if (!/[^\x20-\x7e]/.test(v)) return v
  const parts = []
  let cur = ""
  for (const ch of v) {
    if (cur && Buffer.byteLength(cur + ch, "utf8") > 45) {
      parts.push(Buffer.from(cur, "utf8").toString("base64"))
      cur = ch
    } else {
      cur += ch
    }
  }
  if (cur) parts.push(Buffer.from(cur, "utf8").toString("base64"))
  return parts.map((p) => "=?UTF-8?B?" + p + "?=").join("\r\n ")
}
