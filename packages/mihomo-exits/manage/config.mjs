// What the page's options mean to mihomo: the config.yaml it runs, and the
// shapes the page reads again. No imports and no I/O, so the exits the page
// drew are the exits the kernel runs, and the tests read the same file.
//
// The model is a two-part one:
//
//   exits  — where traffic may leave: DIRECT, or a group the kernel builds
//            over the subscription's nodes, picked by a name filter. The
//            page never sees node names, so an exit is a filter, not a node.
//   routes — a provider and the exit its traffic takes, plus the domains
//            beyond the catalog's that answer for it. Each domain becomes a
//            DOMAIN-SUFFIX rule; everything else takes the default exit.

// The kernel this package pins. It is downloaded once, and its bytes are
// checked against the sums in kernel.mjs before it runs.
export const KERNEL_VERSION = "v1.19.33"

// Defaults are what the page shows before anything was set. The page keeps
// its own copy (page/view.js); the test holds the two together.
export const DEFAULTS = {
  mode: "off", // "tun": the virtual NIC; "proxy": the system proxy; "off": neither
  subscription: "", // a Clash/mihomo subscription or profile URL
  defaultExit: "DIRECT", // what traffic to no route takes
  mirror: "", // a URL prefix set before the kernel's download URL, for networks GitHub is slow from
  kernelPath: "", // a kernel binary of the user's own, instead of the download
  exits: [], // [{id, label, filter, type}]
  routes: [], // [{provider, exit, domains}]
}

// Provider ids magpie and the community plugins serve, with the domains
// their APIs answer on. A provider named here needs no custom domains; any
// other provider takes the ones the page adds to it.
export const CATALOG = {
  anthropic: ["api.anthropic.com"],
  claude: ["api.anthropic.com"],
  openai: ["api.openai.com"],
  codex: ["chatgpt.com", "auth.openai.com", "api.openai.com"],
  chatgpt: ["chatgpt.com", "auth.openai.com"],
  gemini: ["generativelanguage.googleapis.com", "oauth2.googleapis.com"],
  google: ["generativelanguage.googleapis.com"],
  grok: ["api.x.ai", "accounts.x.ai"],
  xai: ["api.x.ai"],
  zcode: ["api.z.ai", "open.bigmodel.cn"],
  zhipu: ["open.bigmodel.cn"],
  deepseek: ["api.deepseek.com"],
  kimi: ["api.moonshot.cn", "api.moonshot.ai"],
  moonshot: ["api.moonshot.cn", "api.moonshot.ai"],
  qwen: ["dashscope.aliyuncs.com"],
  minimax: ["api.minimaxi.com", "api.minimax.chat"],
  "minimax-code": ["api.minimaxi.com", "api.minimax.chat"],
  cursor: ["api2.cursor.sh", "api.cursor.sh"],
  openrouter: ["openrouter.ai"],
  perplexity: ["api.perplexity.ai"],
  mistral: ["api.mistral.ai"],
  copilot: ["api.githubcopilot.com", "api.individual.githubcopilot.com"],
}

// The group an exit's rules name. Prefixed, so it can't collide with a node
// of the subscription's.
export function exitName(label) {
  return `Exit·${label}`
}

// toDomain reads what the page was given: a hostname, or a URL to take the
// hostname of. A `*.` prefix becomes a plain suffix domain, since the rules
// are DOMAIN-SUFFIX ones anyway. Anything that isn't a hostname is nothing.
export function toDomain(raw) {
  let s = String(raw ?? "").trim().toLowerCase()
  if (!s) return ""
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    try { s = new URL(s).hostname } catch { return "" }
  } else if (s.includes("/")) {
    s = s.split("/")[0]
  }
  s = s.replace(/^\*+\./, "").replace(/^\.+/, "").replace(/[.,]+$/, "")
  if (!/^[a-z0-9.-]+$/.test(s) || !s.includes(".") || s.includes("..")) return ""
  if (s.length > 253 || s.startsWith("-") || s.endsWith("-")) return ""
  return s
}

// domainsFor is what answers for a provider: the catalog's domains, then
// the route's own, in the order the page shows them.
export function domainsFor(provider, route) {
  const out = []
  for (const d of CATALOG[provider] ?? []) if (!out.includes(d)) out.push(d)
  for (const d of route?.domains ?? []) if (!out.includes(d)) out.push(d)
  return out
}

// normalize is the options as they stand, whatever the file had: the fields
// capped, the exits named without a clash, the routes pointing at exits
// that exist, domains that are hostnames only. Nothing here throws: a mad
// options object reads as the defaults.
export function normalize(raw) {
  const o = raw && typeof raw === "object" ? raw : {}
  const mode = ["tun", "proxy", "off"].includes(o.mode) ? o.mode : DEFAULTS.mode

  const exits = []
  const names = new Set()
  for (const e of Array.isArray(o.exits) ? o.exits : []) {
    if (!e || typeof e !== "object") continue
    const label = String(e.label ?? "").trim().replace(/\s+/g, " ").slice(0, 32)
    const filter = String(e.filter ?? "").trim().slice(0, 200)
    const type = ["url-test", "select", "fallback"].includes(e.type) ? e.type : "url-test"
    if (!label || !filter) continue
    let name = exitName(label)
    for (let k = 2; names.has(name); k++) name = `${exitName(label)} ${k}`
    names.add(name)
    let id = typeof e.id === "string" ? e.id.trim().slice(0, 40) : ""
    if (!id || exits.some((x) => x.id === id)) id = `x${exits.length + 1}`
    exits.push({ id, label, filter, type, name })
  }

  const ids = new Set(exits.map((e) => e.id))
  const defaultExit = o.defaultExit === "DIRECT" || ids.has(o.defaultExit) ? o.defaultExit : DEFAULTS.defaultExit

  const routes = []
  const providers = new Set()
  for (const r of Array.isArray(o.routes) ? o.routes : []) {
    if (!r || typeof r !== "object") continue
    const provider = String(r.provider ?? "").trim().slice(0, 64)
    if (!provider || providers.has(provider)) continue
    providers.add(provider)
    const exit = r.exit === "DIRECT" || ids.has(r.exit) ? r.exit : ""
    const domains = [...new Set((Array.isArray(r.domains) ? r.domains : []).map(toDomain).filter(Boolean))].slice(0, 16)
    routes.push({ provider, exit, domains })
  }

  return {
    mode,
    subscription: String(o.subscription ?? "").trim().slice(0, 500),
    defaultExit,
    mirror: String(o.mirror ?? "").trim().slice(0, 200),
    kernelPath: String(o.kernelPath ?? "").trim().slice(0, 300),
    exits,
    routes,
  }
}

// q is a scalar as YAML reads it: JSON's double-quoted string is one YAML
// would too.
function q(s) {
  return JSON.stringify(String(s))
}

// buildConfig is the config.yaml: the controller, DNS and TUN magpie's
// traffic needs, the subscription as a proxy-provider, a group per exit,
// and a rule per domain. The exits are only groups when a subscription
// holds their nodes; without one every route lands on DIRECT, and the page
// says so.
export function buildConfig(norm, rt) {
  const hasSub = Boolean(norm.subscription)
  // without a subscription the exits have no groups to name, so every
  // route lands on DIRECT: a rule may name no proxy that isn't there
  const nameOf = (id) => (id === "DIRECT" || !hasSub ? "DIRECT" : norm.exits.find((e) => e.id === id)?.name ?? "DIRECT")

  const L = []
  L.push(`mixed-port: ${rt.mixed | 0}`)
  L.push(`external-controller: 127.0.0.1:${rt.controller | 0}`)
  L.push(`secret: ${q(rt.secret)}`)
  L.push("allow-lan: false")
  L.push("mode: rule")
  L.push("log-level: warning")
  L.push("ipv6: false")
  L.push("unified-delay: true")
  L.push("tcp-concurrent: true")
  L.push("profile:")
  L.push("  store-selected: true")
  L.push("dns:")
  L.push("  enable: true")
  L.push("  ipv6: false")
  L.push("  enhanced-mode: fake-ip")
  L.push("  fake-ip-range: 198.18.0.1/16")
  L.push("  fake-ip-filter:")
  for (const f of ["+.lan", "+.local", "+.msftconnecttest.com", "+.msftncsi.com", "time.windows.com"]) L.push(`    - ${q(f)}`)
  L.push("  default-nameserver:")
  for (const n of ["223.5.5.5", "1.1.1.1"]) L.push(`    - ${n}`)
  L.push("  nameserver:")
  for (const n of ["https://doh.pub/dns-query", "https://dns.alidns.com/dns-query", "https://cloudflare-dns.com/dns-query"]) L.push(`    - ${q(n)}`)
  L.push("tun:")
  L.push(`  enable: ${norm.mode === "tun"}`)
  L.push("  stack: mixed")
  L.push("  dns-hijack:")
  L.push(`    - ${q("any:53")}`)
  L.push("  auto-route: true")
  L.push("  auto-detect-interface: true")
  L.push("  strict-route: false")
  L.push("sniffer:")
  L.push("  enable: true")
  L.push("  sniff:")
  L.push("    TLS:")
  L.push("      ports: [443, 8443]")
  L.push("    HTTP:")
  L.push("      ports: [80, 8080-8880]")
  L.push("      override-destination: true")

  if (hasSub) {
    L.push("proxy-providers:")
    L.push("  magpie-sub:")
    L.push("    type: http")
    L.push(`    url: ${q(norm.subscription)}`)
    L.push("    interval: 86400")
    L.push(`    path: ${q(rt.path)}`)
    L.push("    health-check:")
    L.push("      enable: true")
    L.push("      lazy: true")
    L.push(`      url: ${q("https://www.gstatic.com/generate_204")}`)
    L.push("      interval: 1800")
    L.push("proxy-groups:")
    for (const e of norm.exits) {
      L.push(`  - name: ${q(e.name)}`)
      L.push(`    type: ${e.type}`)
      L.push("    use:")
      L.push("      - magpie-sub")
      L.push(`    filter: ${q(e.filter)}`)
      if (e.type !== "select") {
        L.push(`    url: ${q("https://www.gstatic.com/generate_204")}`)
        L.push("    interval: 1800")
        L.push("    tolerance: 60")
      }
    }
  }

  L.push("rules:")
  for (const r of norm.routes) {
    if (!r.exit) continue // no rule: the route falls to the default exit
    for (const d of domainsFor(r.provider, r)) {
      L.push(`  - ${q(`DOMAIN-SUFFIX,${d},${nameOf(r.exit)}`)}`)
    }
  }
  L.push(`  - ${q(`MATCH,${nameOf(norm.defaultExit)}`)}`)
  return L.join("\n") + "\n"
}
