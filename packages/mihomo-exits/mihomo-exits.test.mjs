import { expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { CATALOG, DEFAULTS, KERNEL_VERSION, buildConfig, domainsFor, exitName, normalize, toDomain } from "./manage/config.mjs"

const dir = import.meta.dir
const page = join(dir, "page")
const read = (f) => readFileSync(join(dir, f), "utf8")
const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))

// view.js is a classic script, as the page loads it
const scope = {}
new Function("globalThis", read("page/view.js"))(scope)
const V = scope.TrafficView

test("is a page and a gateway-hook package at once: no OpenCode entry", () => {
  expect(pkg.name).toBe("@magpie-community/page-mihomo-exits")
  expect(pkg.main).toBeUndefined()
  expect(pkg.exports).toBeUndefined()
  expect(pkg.magpie.hooks).toBe("./mihomo.hooks.ts")
  expect(pkg.magpie.page.file).toBe("page/index.html")
  expect(pkg.magpie.permissions).toEqual(["providers:list", "usage:summary"])
  expect(pkg.magpie.panels).toEqual([
    { slot: "provider", title: "Traffic exit", titles: expect.anything(), file: "page/panel.html" },
  ])
  expect(pkg.magpie.actions).toEqual([
    { id: "traffic-exit", menu: "provider", title: "Traffic exit…", titles: expect.anything() },
  ])
  for (const f of ["mihomo.hooks.ts", "manage/config.mjs", "manage/kernel.mjs", ...pkg.files.filter((f) => !f.endsWith("/"))].map((f) => join(dir, f))) {
    expect(existsSync(f)).toBe(true)
  }
})

test("the page asks for its two reads and no network", () => {
  const reads = new Set()
  for (const f of readdirSync(page).filter((f) => f.endsWith(".js"))) {
    const src = read(`page/${f}`)
    for (const m of src.matchAll(/magpie\.read\(\s*"([^"]+)"/g)) reads.add(m[1])
    // no way out of the frame: magpie's policy refuses these anyway
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts/)
  }
  expect([...reads].sort()).toEqual(["providers:list", "usage:summary"])
})

test("the page's files: scripts as files, nothing outside the folder", () => {
  for (const html of ["page/index.html", "page/panel.html"]) {
    const src = read(html)
    expect(src).toContain('<script src="_magpie/bridge.js"></script>')
    for (const m of src.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      expect(m[1]).toMatch(/\ssrc="/)
      expect(m[2].trim()).toBe("")
    }
    for (const m of src.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (m[1].startsWith("_magpie/")) continue
      expect(m[1]).not.toMatch(/^(?:[a-z]+:|\/|\.\.)/i)
      expect(readdirSync(page)).toContain(m[1])
    }
  }
})

test("toDomain reads hostnames and URLs, and nothing else", () => {
  expect(toDomain("https://api.example.com/v1/messages")).toBe("api.example.com")
  expect(toDomain("*.EXAMPLE.com")).toBe("example.com")
  expect(toDomain("api.anthropic.com")).toBe("api.anthropic.com")
  expect(toDomain("  api.deepseek.com ")).toBe("api.deepseek.com")
  expect(toDomain("")).toBe("")
  expect(toDomain("not a domain")).toBe("")
  expect(toDomain("http://")).toBe("")
  expect(toDomain("..")).toBe("")
  expect(toDomain("localhost")).toBe("")
})

test("normalize is the defaults whatever came, and keeps exits and routes sane", () => {
  expect(normalize(undefined)).toEqual(normalize(null))
  expect(normalize("nonsense")).toEqual(DEFAULTS)
  expect(normalize({ mode: "yolo" }).mode).toBe("off")
  expect(normalize({ mode: "tun" }).mode).toBe("tun")

  const norm = normalize({
    exits: [
      { id: "a", label: "US", filter: "(?i)US|United States", type: "url-test" },
      { id: "a", label: "US", filter: "x" }, // the same id twice: the second renamed
      { label: "", filter: "y" }, // no label, no exit
      { label: "JP", filter: "" }, // no filter, no exit
      { label: " HK ", filter: "(?i)HK|Hong ?Kong|香港", type: "weird" }, // unknown type is url-test
    ],
    routes: [
      { provider: "zcode", exit: "a", domains: ["open.bigmodel.cn", "https://api.z.ai/v1", "no no"] },
      { provider: "zcode", exit: "DIRECT" }, // a provider twice: the first stands
      { provider: "ghost", exit: "deleted" }, // an exit that is not there: no rule
    ],
  })
  expect(norm.exits.map((e) => [e.id, e.label, e.name])).toEqual([
    ["a", "US", exitName("US")],
    ["x2", "US", `${exitName("US")} 2`],
    ["x3", "HK", exitName("HK")],
  ])
  expect(norm.exits[2].type).toBe("url-test")
  expect(norm.routes).toEqual([
    { provider: "zcode", exit: "a", domains: ["open.bigmodel.cn", "api.z.ai"] },
    { provider: "ghost", exit: "", domains: [] },
  ])
  expect(normalize({ defaultExit: "deleted" }).defaultExit).toBe("DIRECT")
})

test("domainsFor: the catalog first, then the route's own, without repeats", () => {
  expect(domainsFor("zcode", { domains: ["api.z.ai", "else.example.com"] })).toEqual(["api.z.ai", "open.bigmodel.cn", "else.example.com"])
  expect(domainsFor("nobody", { domains: ["x.example.com"] })).toEqual(["x.example.com"])
})

const RT = { mixed: 17890, controller: 19090, secret: "s3cret", path: "./providers/magpie-sub.yaml" }

test("buildConfig: rules for every domain, groups for every exit", () => {
  const norm = normalize({
    mode: "tun",
    subscription: "https://subs.example.com/clash.yaml",
    defaultExit: "a",
    exits: [{ id: "a", label: "US", filter: "(?i)US" }],
    routes: [
      { provider: "zcode", exit: "a", domains: [] },
      { provider: "deepseek", exit: "DIRECT", domains: [] },
      { provider: "quiet", exit: "", domains: [] },
    ],
  })
  const yaml = buildConfig(norm, RT)
  const rules = yaml.split("\n").filter((l) => l.includes("DOMAIN-SUFFIX"))
  expect(rules).toEqual([
    '  - "DOMAIN-SUFFIX,api.z.ai,Exit·US"',
    '  - "DOMAIN-SUFFIX,open.bigmodel.cn,Exit·US"',
    '  - "DOMAIN-SUFFIX,api.deepseek.com,DIRECT"',
  ])
  expect(yaml).toContain("MATCH,Exit·US")
  expect(yaml).toContain("tun:\n  enable: true")
  expect(yaml).toContain("external-controller: 127.0.0.1:19090")
  expect(yaml).toContain('"https://subs.example.com/clash.yaml"')
  expect(yaml).toContain("proxy-groups:")
  expect(yaml).toContain("filter: \"(?i)US\"")
  // the default exit and the untouched provider are not left as rules
  expect(yaml).not.toContain("quiet")
})

test("buildConfig with the NIC off, and with no subscription", () => {
  const off = buildConfig(normalize({ mode: "off" }), RT)
  expect(off).toContain("tun:\n  enable: false")
  expect(off).toContain("MATCH,DIRECT")
  expect(off).not.toContain("proxy-providers:")

  const subbed = normalize({ subscription: "https://x.example.com/s.yaml", exits: [{ id: "a", label: "US", filter: "US" }], routes: [{ provider: "zcode", exit: "a" }] })
  expect(buildConfig(subbed, RT)).toContain("DOMAIN-SUFFIX,api.z.ai,Exit·US")

  // no subscription: the exits have no groups, so every route is DIRECT
  const bare = normalize({ exits: [{ id: "a", label: "US", filter: "US" }], routes: [{ provider: "zcode", exit: "a" }], defaultExit: "a" })
  const yaml = buildConfig(bare, RT)
  expect(yaml).not.toContain("proxy-groups:")
  expect(yaml).toContain("DOMAIN-SUFFIX,api.z.ai,DIRECT")
  expect(yaml).toContain("MATCH,DIRECT")
})

test("the config is YAML mihomo can read", () => {
  if (!Bun.YAML) return
  const norm = normalize({
    mode: "tun",
    subscription: "https://subs.example.com/clash.yaml",
    exits: [
      { id: "a", label: "美国 US", filter: "(?i)US|United States|美国" },
      { id: "b", label: "HK", filter: "(?i)HK", type: "select" },
    ],
    routes: [
      { provider: "zcode", exit: "a", domains: ["my.example.com"] },
      { provider: "deepseek", exit: "DIRECT", domains: [] },
    ],
  })
  const cfg = Bun.YAML.parse(buildConfig(norm, RT))
  expect(cfg["mixed-port"]).toBe(17890)
  expect(cfg["external-controller"]).toBe("127.0.0.1:19090")
  expect(cfg.dns["enhanced-mode"]).toBe("fake-ip")
  expect(cfg.tun.enable).toBe(true)
  expect(cfg["proxy-providers"]["magpie-sub"].url).toBe("https://subs.example.com/clash.yaml")
  expect(cfg["proxy-groups"]).toHaveLength(2)
  expect(cfg["proxy-groups"][0].filter).toBe("(?i)US|United States|美国")
  expect(cfg.rules).toEqual([
    "DOMAIN-SUFFIX,api.z.ai,Exit·美国 US",
    "DOMAIN-SUFFIX,open.bigmodel.cn,Exit·美国 US",
    "DOMAIN-SUFFIX,my.example.com,Exit·美国 US",
    "DOMAIN-SUFFIX,api.deepseek.com,DIRECT",
    "MATCH,DIRECT",
  ])
})

test("the page's defaults and catalog are the host's", () => {
  expect(V.defaults()).toEqual({ mode: DEFAULTS.mode, subscription: "", defaultExit: DEFAULTS.defaultExit, mirror: "", kernelPath: "", exits: [], routes: [] })
  expect(V.CATALOG).toEqual(CATALOG)
  for (const raw of ["https://api.example.com/v1", "*.Example.com", "no no", "", "..", "localhost"]) {
    expect(V.cleanDomain(raw)).toBe(toDomain(raw))
  }
})

test("every string the page says, it says in all five languages", () => {
  const en = Object.keys(V.text("en"))
  for (const lang of ["zh", "zh-TW", "ja", "de"]) {
    const got = V.text(lang)
    expect(lang in { zh: 1, "zh-TW": 1, ja: 1, de: 1 }).toBe(true)
    for (const k of en) expect(typeof got[k]).toBe("string")
  }
  expect(V.text("zh-CN")).toBe(V.text("zh"))
  expect(V.text("fr")).toBe(V.text("en"))
})

test("the flow map: routed providers first, one curve each, the unknown to the default", () => {
  const providers = [
    { id: "zcode", name: "ZCode" },
    { id: "ghost", name: "Ghost" },
    { id: "loose", name: "Loose" },
    { id: "p4", name: "P4" },
  ]
  const exits = [{ id: "a", label: "US" }]
  const routes = [
    { provider: "zcode", exit: "a", domains: [] },
    { provider: "ghost", exit: "DIRECT", domains: [] },
    { provider: "loose", exit: "deleted", domains: [] },
  ]
  const L = V.flowLayout(providers, exits, routes, 640, 240)
  expect(L.left.map((p) => p.id)).toEqual(["zcode", "ghost", "loose", "p4"])
  expect(L.right.map((n) => n.key)).toEqual(["DIRECT", "a", "@default"])
  expect(L.links).toEqual([
    { provider: "zcode", to: "a", dim: false, d: expect.any(String) },
    { provider: "ghost", to: "DIRECT", dim: false, d: expect.any(String) },
    { provider: "loose", to: "@default", dim: true, d: expect.any(String) },
  ])
  expect(L.hidden).toBe(0)
  // more providers than rows: the routed ones stay
  const many = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))
  const L2 = V.flowLayout(many, exits, [{ provider: "p13", exit: "a", domains: [] }], 640, 240)
  expect(L2.hidden).toBe(4)
  expect(L2.left[0].id).toBe("p13")
})

test("packets breathe with the day's calls, never past their ceiling", () => {
  expect(V.spawnRate(0, 0)).toBe(0.5)
  expect(V.spawnRate(0, 1)).toBeCloseTo(1.4)
  expect(V.spawnRate(0, 100)).toBe(8)
  expect(V.spawnRate(5, 3)).toBe(V.spawnRate(0, 0)) // time only runs forward
})

test("the hooks file parses, and exports onRequest alone", () => {
  const t = new Bun.Transpiler({ loader: "ts" })
  const out = t.scan(read("mihomo.hooks.ts"))
  expect(out.exports).toContain("onRequest")
  expect(out.imports.map((i) => i.path)).toEqual(["./manage/kernel.mjs"])
})

test("the kernel is pinned, and every machine it runs on has a sum", async () => {
  const { SUMS, assetName } = await import("./manage/kernel.mjs")
  expect(KERNEL_VERSION).toMatch(/^v\d+\.\d+\.\d+$/)
  expect(assetName("win32", "x64")).toBe(`mihomo-windows-amd64-${KERNEL_VERSION}.zip`)
  expect(assetName("darwin", "arm64")).toBe(`mihomo-darwin-arm64-${KERNEL_VERSION}.gz`)
  expect(assetName("darwin", "x64")).toBe(`mihomo-darwin-amd64-${KERNEL_VERSION}.gz`)
  expect(assetName("linux", "x64")).toBe(`mihomo-linux-amd64-${KERNEL_VERSION}.gz`)
  expect(assetName("linux", "arm64")).toBe(`mihomo-linux-arm64-${KERNEL_VERSION}.gz`)
  expect(assetName("freebsd", "x64")).toBe("")
  const machines = [
    ["win32", "x64"], ["darwin", "x64"], ["darwin", "arm64"], ["linux", "x64"], ["linux", "arm64"],
  ]
  const stems = machines.map(([p, a]) => assetName(p, a).replace(`-${KERNEL_VERSION}.${assetName(p, a).split(".").pop()}`, ""))
  expect([...Object.keys(SUMS)].sort()).toEqual([...stems].sort())
  for (const sum of Object.values(SUMS)) expect(sum).toMatch(/^[0-9a-f]{64}$/)
})
