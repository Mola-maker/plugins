// The kernel and everything around it: where it lives, how it is fetched,
// how it is started, and how the machine is told about it. The kernel runs
// detached, so it outlives the host, which restarts whenever the page saves
// its options: the next reconcile finds it healthy and only reloads the
// config when the exits changed.
import { createHash, randomBytes } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { pipeline } from "node:stream/promises"
import { KERNEL_VERSION, buildConfig, normalize } from "./config.mjs"

export { KERNEL_VERSION }

// The release assets the sums below were taken from. A changed asset is a
// refused asset: the page then offers kernelPath instead. Exported for the
// test, which holds the five machines magpie runs on to have a sum.
export const SUMS = {
  "mihomo-windows-amd64": "6ab2180875f9f6fff8b19386d760daec257f66b45f72b3afc650634272fa837a",
  "mihomo-darwin-arm64": "060b64b0f2c9a310831db0fe4adb2878de67bfa606c311813c1f13966aa504b6",
  "mihomo-darwin-amd64": "551ae54ef8d77a5e21f7a8185a59b441fb13a0fb0514fcdef5ca2816f6f50015",
  "mihomo-linux-amd64": "132f6f3edf9a65e62f04853aed3358472e0b2b7666daa8419edfa2ddf5bb6323",
  "mihomo-linux-arm64": "ba408b317080ee265c46cb923a50018c1b82cbd708551cdd46a1e3e307396187",
}

// assetName is the release file this machine runs, or "" on a machine no
// asset serves (a compatible build is then the user's kernelPath to give).
export function assetName(platform = process.platform, arch = process.arch) {
  const goos = { win32: "windows", darwin: "darwin", linux: "linux" }[platform]
  const goarch = { x64: "amd64", arm64: "arm64" }[arch]
  if (!goos || !goarch) return ""
  return `mihomo-${goos}-${goarch}-${KERNEL_VERSION}.${goos === "windows" ? "zip" : "gz"}`
}

const EXE = process.platform === "win32" ? "mihomo.exe" : "mihomo"

// magpie keeps its own files in ~/.config/magpie, or in a data folder
// beside it when portable (internal/appdir). The kernel, its config and its
// state sit under that, so they survive plugin updates.
export function configRoot(cwd = process.cwd()) {
  if (path.basename(cwd) === "data" || fs.existsSync(path.join(cwd, "data"))) {
    return path.basename(cwd) === "data" ? cwd : path.join(cwd, "data")
  }
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg && path.isAbsolute(xdg)) return path.join(xdg, "magpie")
  return path.join(os.homedir(), ".config", "magpie")
}

export function paths(cwd) {
  const root = path.join(configRoot(cwd), "mihomo-exits")
  return {
    root,
    bin: path.join(root, "bin", EXE),
    config: path.join(root, "config.yaml"),
    state: path.join(root, "state.json"),
    log: path.join(root, "mihomo.log"),
    download: path.join(root, "downloads"),
  }
}

// state.json remembers the ports, the secret and what the machine's proxy
// was before the plugin touched it, so the next host reads the same kernel.
export function stateRead(p = paths()) {
  try { return JSON.parse(fs.readFileSync(p.state, "utf8")) } catch { return {} }
}

function stateWrite(st, p = paths()) {
  fs.mkdirSync(p.root, { recursive: true })
  const tmp = `${p.state}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2))
  fs.renameSync(tmp, p.state)
}

function sha(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

function downloadUrl(asset, mirror) {
  const base = mirror ? `${mirror.replace(/\/+$/, "")}/` : "https://github.com/"
  return `${base}Metacubex/mihomo/releases/download/${KERNEL_VERSION}/${asset}`
}

async function fetchKernel(url, dest) {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60_000) })
  if (!r.ok) throw new Error(`download said ${r.status}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
}

async function extract(asset, file, bin, dir) {
  fs.mkdirSync(path.dirname(bin), { recursive: true })
  if (file.endsWith(".gz")) {
    await pipeline(fs.createReadStream(file), zlib.createGunzip(), fs.createWriteStream(bin, { mode: 0o755 }))
    fs.chmodSync(bin, 0o755)
    return
  }
  // a zip: tar reads it on every system magpie runs on; PowerShell when tar
  // is not there. The archive holds one mihomo*.exe, which is renamed.
  let ok = spawnSync("tar", ["-xf", file, "-C", dir], { stdio: "ignore" }).status === 0
  if (!ok && process.platform === "win32") {
    ok = spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${file}' -DestinationPath '${dir}' -Force`], { stdio: "ignore" }).status === 0
  }
  if (!ok) throw new Error("could not unpack the kernel")
  const got = fs.readdirSync(dir).find((f) => /^mihomo.*(\.exe)?$/i.test(f))
  if (!got) throw new Error("the archive holds no kernel")
  fs.renameSync(path.join(dir, got), bin)
  fs.chmodSync(bin, 0o755)
}

// ensureKernel answers the kernel binary to run: the user's own when
// kernelPath says one, else the pinned download, fetched once and checked
// against its sum.
export async function ensureKernel(norm, p = paths()) {
  if (norm.kernelPath) {
    if (!fs.existsSync(norm.kernelPath)) throw new Error(`kernelPath names no file: ${norm.kernelPath}`)
    return norm.kernelPath
  }
  const st = stateRead(p)
  if (fs.existsSync(p.bin) && st.kernelVersion === KERNEL_VERSION) return p.bin
  const asset = assetName()
  if (!asset) throw new Error(`no kernel for ${process.platform}/${process.arch}: set kernelPath`)
  const want = SUMS[asset.slice(0, asset.lastIndexOf(`-${KERNEL_VERSION}`))]
  if (!want) throw new Error(`no sum for ${asset}: set kernelPath`)
  fs.mkdirSync(p.download, { recursive: true })
  const file = path.join(p.download, asset)
  if (!fs.existsSync(file) || sha(file) !== want) {
    await fetchKernel(downloadUrl(asset, norm.mirror), file)
    if (sha(file) !== want) throw new Error("the download is not the file the sum names")
  }
  await extract(asset, file, p.bin, p.download)
  stateWrite({ ...st, kernelVersion: KERNEL_VERSION }, p)
  return p.bin
}

async function freePort(preferred) {
  for (const port of [preferred, 0]) {
    const got = await new Promise((res) => {
      const srv = net.createServer()
      srv.once("error", () => res(0))
      srv.once("listening", () => {
        const { port } = srv.address()
        srv.close(() => res(port))
      })
      srv.listen(port, "127.0.0.1")
    })
    if (got) return got
  }
  return preferred
}

export async function health(controller, secret) {
  try {
    const r = await fetch(`http://127.0.0.1:${controller}/version`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(800),
    })
    return r.ok
  } catch { return false }
}

function spawnDetached(bin, p) {
  try { if (fs.statSync(p.log).size > 5 << 20) fs.writeFileSync(p.log, "") } catch {}
  const out = fs.openSync(p.log, "a")
  const child = spawn(bin, ["-d", p.root], { detached: true, stdio: ["ignore", out, out], windowsHide: true })
  child.unref()
  return child.pid
}

// An elevated start is the UAC prompt (Windows), an administrator
// AppleScript (macOS) or pkexec (Linux): the TUN adapter wants rights the
// host has none of. It is asked only when the plain start didn't come up.
function spawnElevated(bin, p) {
  if (process.platform === "win32") {
    spawn("powershell", ["-NoProfile", "-Command",
      `Start-Process -FilePath '${bin}' -ArgumentList '-d','${p.root}' -Verb RunAs -WindowStyle Hidden`],
    { detached: true, stdio: "ignore", windowsHide: true }).unref()
    return
  }
  const sh = path.join(p.root, "start.sh")
  fs.writeFileSync(sh, `#!/bin/sh\nexec '${bin}' -d '${p.root}'\n`)
  fs.chmodSync(sh, 0o755)
  const args = process.platform === "darwin"
    ? ["-e", `do shell script "sh '${sh}' > /dev/null 2>&1 &" with administrator privileges`]
    : ["sh", sh]
  spawn(process.platform === "darwin" ? "osascript" : "pkexec", args, { detached: true, stdio: "ignore" }).unref()
}

async function waitHealthy(controller, secret, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await health(controller, secret)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

// The system proxy, for the mode that asks no administrator. The machine's
// own settings are backed up in state.json and put back when the mode
// leaves. Best effort: a system the helpers don't cover is left as it was,
// with the failure said in the state.
function proxyApply(cmd, args) {
  return spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" })
}

function setSystemProxy(mixed, st, p) {
  try {
    if (process.platform === "win32") {
      const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"
      const read = (v) => proxyApply("reg", ["query", key, "/v", v]).stdout ?? ""
      st.proxyBackup = { kind: "win", enable: /0x1/.test(read("ProxyEnable")), server: (read("ProxyServer").split("REG_SZ")[1] ?? "").trim() }
      proxyApply("reg", ["add", key, "/v", "ProxyServer", "/t", "REG_SZ", "/d", `127.0.0.1:${mixed}`, "/f"])
      proxyApply("reg", ["add", key, "/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "1", "/f"])
      proxyApply("powershell", ["-NoProfile", "-Command",
        "$s='[DllImport(\"wininet.dll\", SetLastError=true)] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);';" +
        "$t=Add-Type -MemberDefinition $s -Name W -Namespace N -PassThru;" +
        "$t::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0);$t::InternetSetOption([IntPtr]::Zero,95,[IntPtr]::Zero,0)"])
    } else if (process.platform === "darwin") {
      const services = (proxyApply("networksetup", ["-listallnetworkservices"]).stdout ?? "")
        .split("\n").slice(1).map((s) => s.trim()).filter((s) => s && !s.startsWith("*"))
      const backup = []
      for (const svc of services) {
        const read = (kind) => (proxyApply("networksetup", [`-get${kind}proxy`, svc]).stdout ?? "")
        const one = (out) => ({
          on: /^Enabled: Yes/.test(out), server: (out.match(/^Server: (.*)$/m) ?? [])[1] ?? "",
          port: (out.match(/^Port: (.*)$/m) ?? [])[1] ?? "",
        })
        backup.push({ svc, web: one(read("web")), secure: one(read("secure")) })
        proxyApply("networksetup", ["-setwebproxy", svc, "127.0.0.1", String(mixed)])
        proxyApply("networksetup", ["-setsecureproxy", svc, "127.0.0.1", String(mixed)])
      }
      st.proxyBackup = { kind: "mac", services: backup }
    } else {
      const g = (k) => (proxyApply("gsettings", ["get", k]).stdout ?? "").trim()
      st.proxyBackup = {
        kind: "linux",
        mode: g("org.gnome.system.proxy mode"),
        http: [g("org.gnome.system.proxy.http host"), g("org.gnome.system.proxy.http port")],
        https: [g("org.gnome.system.proxy.https host"), g("org.gnome.system.proxy.https port")],
      }
      proxyApply("gsettings", ["set", "org.gnome.system.proxy", "mode", "manual"])
      proxyApply("gsettings", ["set", "org.gnome.system.proxy.http", "host", "127.0.0.1"])
      proxyApply("gsettings", ["set", "org.gnome.system.proxy.http", "port", String(mixed)])
      proxyApply("gsettings", ["set", "org.gnome.system.proxy.https", "host", "127.0.0.1"])
      proxyApply("gsettings", ["set", "org.gnome.system.proxy.https", "port", String(mixed)])
    }
  } catch (e) {
    st.lastError = `system proxy: ${e?.message ?? e}`
  }
  stateWrite(st, p)
}

function restoreSystemProxy(st, p) {
  const back = st.proxyBackup
  if (!back) return
  try {
    if (back.kind === "win") {
      const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"
      proxyApply("reg", ["add", key, "/v", "ProxyEnable", "/t", "REG_DWORD", "/d", back.enable ? "1" : "0", "/f"])
      if (back.server) proxyApply("reg", ["add", key, "/v", "ProxyServer", "/t", "REG_SZ", "/d", back.server, "/f"])
    } else if (back.kind === "mac") {
      for (const { svc, web, secure } of back.services ?? []) {
        for (const [kind, one] of [["web", web], ["secure", secure]]) {
          if (one.on) proxyApply("networksetup", [`-set${kind}proxy`, svc, one.server, one.port])
          else proxyApply("networksetup", [`-set${kind}proxystate`, svc, "off"])
        }
      }
    } else if (back.kind === "linux") {
      proxyApply("gsettings", ["set", "org.gnome.system.proxy", "mode", back.mode?.replaceAll("'", "") || "none"])
      for (const [k, [host, port]] of [["http", back.http], ["https", back.https]]) {
        if (host?.replaceAll("'", "")) proxyApply("gsettings", ["set", `org.gnome.system.proxy.${k}`, "host", host.replaceAll("'", "")])
        if (port?.replaceAll("'", "")) proxyApply("gsettings", ["set", `org.gnome.system.proxy.${k}`, "port", port.replaceAll("'", "")])
      }
    }
  } catch (e) {
    st.lastError = `system proxy restore: ${e?.message ?? e}`
  }
  delete st.proxyBackup
  stateWrite(st, p)
}

// reconcile brings the machine to what the options say: kernel on disk,
// config written, kernel up (started plain, then elevated when the virtual
// NIC asked for rights it hadn't), config reloaded when only it changed,
// and the system proxy on or off. It never throws: what went wrong is said
// in state.json's lastError, for the next run to try again.
export async function reconcile(rawOptions, p = paths()) {
  const norm = normalize(rawOptions)
  let st = stateRead(p)
  try {
    if (norm.mode !== "off") await ensureKernel(norm, p)
  } catch (e) {
    st.lastError = e?.message ?? String(e)
    stateWrite(st, p)
    return { norm, st, kernel: "" }
  }

  const mixed = st.mixed ?? (await freePort(17890))
  const controller = st.controller ?? (await freePort(19090))
  const secret = st.secret ?? randomBytes(18).toString("hex")
  const yaml = buildConfig(norm, {
    mixed,
    controller,
    secret,
    path: path.join(p.root, "providers", "magpie-sub.yaml").replaceAll("\\", "/"),
  })
  const hash = createHash("sha256").update(yaml).digest("hex")
  fs.mkdirSync(p.root, { recursive: true })
  try { fs.writeFileSync(`${p.config}.tmp`, yaml); fs.renameSync(`${p.config}.tmp`, p.config) } catch {}

  const was = await health(controller, secret)
  if (norm.mode === "off") {
    if (was && st.hash !== hash) await reload(controller, secret, p.config)
    restoreSystemProxy(st, p)
    st = { ...st, hash, mode: "off", lastError: "" }
    stateWrite(st, p)
    return { norm, st, kernel: fs.existsSync(p.bin) ? p.bin : "" }
  }

  if (!was) {
    const bin = norm.kernelPath || p.bin
    const pid = spawnDetached(bin, p)
    st.pid = pid
    if (await waitHealthy(controller, secret, 4000)) {
      st.lastError = ""
    } else if (norm.mode === "tun") {
      spawnElevated(bin, p)
      if (await waitHealthy(controller, secret, 12000)) st.lastError = ""
      else st.lastError = "the kernel did not come up (an administrator prompt may have been refused)"
    } else {
      st.lastError = "the kernel did not come up; its log is in the state folder"
    }
  } else if (st.hash !== hash) {
    await reload(controller, secret, p.config)
    st.lastError = ""
  }
  st = { ...st, mixed, controller, secret, hash, mode: norm.mode, kernelVersion: st.kernelVersion ?? KERNEL_VERSION }
  if (norm.mode === "proxy" && !st.proxyBackup) setSystemProxy(mixed, st, p)
  if (norm.mode !== "proxy" && st.proxyBackup) restoreSystemProxy(st, p)
  stateWrite(st, p)
  return { norm, st, kernel: norm.kernelPath || p.bin }
}

async function reload(controller, secret, config) {
  try {
    await fetch(`http://127.0.0.1:${controller}/configs?force=true`, {
      method: "PUT",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ path: config }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {}
}

// ownOptions reads this plugin's options from plugins.json, for the start
// before any request has come: the host hands them to the hook only.
export async function ownOptions(pkg, p = paths()) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(path.dirname(p.root), "plugins.json"), "utf8"))
    for (const e of list.plugins ?? []) {
      if (typeof e.spec === "string" && e.spec.includes(pkg)) return e.options ?? {}
    }
  } catch {}
  return undefined
}

// ensureUp is reconcile, throttled: the same options within four seconds are
// one reconcile, however many requests came in between, and two reconciles
// never run at once. What it throws is said, not raised: the request goes
// on whatever the kernel did.
let last = { raw: "", at: 0, run: null }
export function ensureUp(rawOptions, p = paths()) {
  const raw = JSON.stringify(rawOptions ?? null)
  if (last.run && last.raw === raw && Date.now() - last.at < 4000) return last.run
  last = {
    raw,
    at: Date.now(),
    run: reconcile(rawOptions, p).catch((e) => {
      console.warn("[mihomo-exits]", e?.message ?? e)
      return null
    }),
  }
  return last.run
}
