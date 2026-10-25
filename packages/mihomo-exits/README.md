# @magpie-community/page-mihomo-exits

A page in [magpie](https://usemagpie.ai)'s window that splits your traffic the way you set it: a [mihomo](https://github.com/Metacubex/mihomo) kernel runs a **TUN virtual network adapter** (or, without administrator rights, the system proxy), and every provider your agents are served with takes the **exit** you give it on the page — DIRECT, or a group of the subscription's nodes picked by name.

Install it from magpie's **Plugins › Discover**, or with `magpie plugin add @magpie-community/page-mihomo-exits`. It then has a tab, **Traffic exits** (titled in the window's language: 流量出口， トラフィック出口， Traffic-Exits), under Plugins in the sidebar, a **Traffic exit** panel in every provider's editor, and a **Traffic exit…** item on every provider row's menu.

## How it works

- **The page** (the only part you see) keeps everything in the plugin's own options: the mode, the subscription, the exits, and each provider's route. magpie restarts the plugin host when the page saves, so the kernel hears of a change within seconds.
- **The gateway hook** (`mihomo.hooks.ts`, magpie's `magpie.hooks` entry) runs in magpie's plugin host. At host start and on every request it brings the machine to what the options say: kernel on disk, config written, kernel healthy. The kernel itself runs **detached**, so it outlives the host and is never restarted by an options save — only reloaded, through mihomo's own API, when the exits changed.
- **The kernel** is mihomo at a pinned version, downloaded once from GitHub releases and checked against its SHA-256 before it runs (see `manage/kernel.mjs` for the five sums). A `kernelPath` option uses a binary of your own instead, and a `mirror` option prefixes the download for networks GitHub is slow from.

The generated config (`~/.config/magpie/mihomo-exits/config.yaml` — or the portable `data` folder's) is DNS with fake-ip, a sniffer, TUN with `auto-route` when the mode is the virtual NIC, one `proxy-provider` for the subscription, one `proxy-group` per exit (its nodes are the subscription's, named by the exit's filter), and one `DOMAIN-SUFFIX` rule per provider domain. magpie knows domains for the common providers (`zcode`, `codex`, `grok`, `kimi`, `deepseek`, …, the catalog in `manage/config.mjs`); every provider takes more domains on the page.

## Modes

| Mode | What runs | Rights |
|---|---|---|
| **Virtual NIC** | mihomo with TUN, `auto-route` and DNS hijack: every app's traffic meets the rules, so each provider's does too | the first start asks an administrator (UAC, AppleScript or pkexec) |
| **System proxy** | mihomo on a local port, the system proxy pointed at it (set and put back by the plugin) | none |
| **Off** | nothing; exits and routes stay saved | none |

The machine's own proxy settings are backed up in `state.json` before the system-proxy mode touches them and put back when the mode leaves. Failures are never raised: they are said in `state.json`'s `lastError`, and the next request tries again.

## What it reads

`providers:list` (the providers the page names) and `usage:summary` (today's calls, whose pace the flow map's packets breathe at). Both are declared in `magpie.permissions`; magpie refuses any other read the page asks for.

Like every plugin page, it runs in a sandboxed frame: no network (`connect-src 'none'`), no inline scripts, no access to magpie's API except through `_magpie/bridge.js`. The flow map's animation is drawn for every provider whose traffic has an exit; its pace follows today's calls, not the wire, and it is still when the window is asked to be (`prefers-reduced-motion`).

## Options

```json
{ "mode": "off", "subscription": "", "defaultExit": "DIRECT", "mirror": "", "kernelPath": "", "exits": [], "routes": [] }
```

The page saves all of them: the mode you left it in, the subscription, the exits (each `{id, label, filter, type}` with `url-test`, `select` or `fallback`), and the routes (each `{provider, exit, domains}` — `exit` empty, `DIRECT`, or an exit's id; `domains` the custom ones beyond the catalog's). An exit whose filter names no node keeps no traffic, and a route naming an exit that is gone falls to the default, so nothing dangles.

## Files

- `page/`: the page and the provider panel, styled by magpie's theme through the `--magpie-*` variables, light or dark. `view.js` holds the strings (en, zh, zh-TW, ja, de) and the pure shapes; `menu.js` is the page's own menu, drawn the window's way; `app.js` and `panel.js` read through the bridge and draw.
- `mihomo.hooks.ts`: the gateway entry — the bring-up and the per-request healing.
- `manage/config.mjs`: options to config.yaml, with no imports and no I/O.
- `manage/kernel.mjs`: the kernel's places, its download and its start, and the system proxy's set and restore.

## Test

```sh
bun test packages/mihomo-exits
```

中文：在 magpie 窗口里加一个「流量出口」页面：mihomo 内核跑起一块 TUN 虚拟网卡（或无管理员权限时使用系统代理），每个 provider 的流量走你在页面上指定的出口——直连，或按节点名从订阅里选出的出口分组。内核按固定版本下载并做 SHA-256 校验， detached 运行，不随插件宿主重启；配置有变化时通过 mihomo 自己的 API 热重载。页面读取的只有声明过的 `providers:list` 与 `usage:summary`，运行在无网络的沙盒 frame 里；路径动画的流速跟随当天调用量，并尊重系统的减少动态设置。
