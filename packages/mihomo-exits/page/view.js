// What the page says and how the flow map lies out, with no DOM: the test
// loads this file and reads the same shapes the page draws. The strings
// come in magpie's five window languages; everything else mirrors
// manage/config.mjs, and the test holds the two together.
(() => {
  const STRINGS = {
    en: {
      title: "Traffic exits",
      modeTun: "Virtual NIC", modeProxy: "System proxy", modeOff: "Off",
      hintTun: "mihomo runs a virtual network adapter and hands every provider's traffic the exit below. The first start asks an administrator once (the NIC wants it).",
      hintProxy: "mihomo runs on a local port and the system proxy points at it: browsers and most apps follow it, with no administrator asked.",
      hintOff: "Nothing runs. Exits and routes stay saved for the next start.",
      setup: "Subscription", subPlaceholder: "https://…/clash.yaml", save: "Save", saved: "Saved",
      setupHint: "A Clash or mihomo subscription (or profile) URL. The exits below pick their nodes out of it by name.",
      advanced: "Advanced", mirror: "Download mirror", kernelPath: "Kernel path",
      mirrorHint: "A URL prefix put before the kernel's GitHub download, for networks GitHub is slow from.",
      kernelPathHint: "A mihomo binary of your own, used instead of the download.",
      exits: "Exits", addExit: "Add exit",
      exitLabel: "Name, as the map shows it", exitFilter: "Node name filter (regular expression)",
      typeUrlTest: "Fastest", typeSelect: "Manual", typeFallback: "Fallback",
      add: "Add", cancel: "Cancel", remove: "Remove",
      exitHint: "An exit keeps the nodes its filter names and keeps the fastest of them answering, unless it is manual. Nodes come from the subscription.",
      noSub: "Set a subscription first: an exit has no nodes to keep without one.",
      providers: "Providers", providersHint: "The providers magpie serves your agents with, and the exit each one's traffic takes. Providers magpie knows domains for are ready as they are; the others take the domains you add.",
      noProviders: "No providers yet: add one in magpie's Providers page.",
      noRule: "No rule", direct: "Direct", default: "Default",
      domains: "Domains", addDomain: "Add domain", domainPlaceholder: "api.example.com",
      flow: "Flow", animOn: "Animate", animOff: "Still",
      flowNote: "Packets are drawn for every provider whose traffic has an exit; their pace follows today's calls, not the wire.",
      footer: "The kernel runs while magpie does: the exits above are its rules, the virtual NIC its adapter. Nothing of your traffic leaves this machine but through the exits you picked.",
      failed: "Couldn't load", removeDomain: "Remove domain",
      more: "+{n} more",
      panelHint: "This provider's traffic leaves through:",
    },
    zh: {
      title: "流量出口",
      modeTun: "虚拟网卡", modeProxy: "系统代理", modeOff: "关闭",
      hintTun: "mihomo 运行一块虚拟网卡，把每个 provider 的流量交给自己对应的出口。首次启动会请求一次管理员权限（虚拟网卡需要）。",
      hintProxy: "mihomo 运行在本地端口上，系统代理指向它：浏览器和多数应用都会跟随，不需要管理员权限。",
      hintOff: "什么都不运行。出口和分流会保留，下次启动继续用。",
      setup: "订阅", subPlaceholder: "https://…/clash.yaml", save: "保存", saved: "已保存",
      setupHint: "Clash 或 mihomo 的订阅（或配置文件）链接。下面的出口按节点名从订阅里挑选节点。",
      advanced: "高级", mirror: "下载镜像", kernelPath: "内核路径",
      mirrorHint: "放在内核 GitHub 下载地址前面的前缀，适合访问 GitHub 较慢的网络。",
      kernelPathHint: "用你自己的 mihomo 可执行文件，代替自动下载。",
      exits: "出口", addExit: "添加出口",
      exitLabel: "名称（显示在路径图上）", exitFilter: "节点名过滤（正则表达式）",
      typeUrlTest: "自动最快", typeSelect: "手动选择", typeFallback: "故障转移",
      add: "添加", cancel: "取消", remove: "删除",
      exitHint: "出口保留其过滤命中的节点；除手动类型外，始终走其中最快的。节点来自订阅。",
      noSub: "请先填写订阅：没有订阅，出口就没有可选的节点。",
      providers: "Provider", providersHint: "magpie 服务各个 agent 用的 provider，以及每个 provider 的流量走哪个出口。常见 provider 的域名已内置，其余的可以自行添加。",
      noProviders: "还没有 provider：先在 magpie 的 Provider 页添加。",
      noRule: "不分流", direct: "直连", default: "默认",
      domains: "域名", addDomain: "添加域名", domainPlaceholder: "api.example.com",
      flow: "路径", animOn: "动画", animOff: "静止",
      flowNote: "为每个设置了出口的 provider 画一条流动的路径；流速跟随今天的调用数，不代表实际流量。",
      footer: "内核随 magpie 一起运行：上面的出口就是它的规则，虚拟网卡就是它的网卡。除你选择的出口外，流量不会经过别处离开本机。",
      failed: "读取失败", removeDomain: "删除域名",
      more: "还有 {n} 个",
      panelHint: "这个 provider 的流量从这里出去：",
    },
    "zh-TW": {
      title: "流量出口",
      modeTun: "虛擬網卡", modeProxy: "系統代理", modeOff: "關閉",
      hintTun: "mihomo 執行一塊虛擬網卡，把每個 provider 的流量交給自己對應的出口。首次啟動會請求一次管理員權限（虛擬網卡需要）。",
      hintProxy: "mihomo 執行在本機連接埠上，系統代理指向它：瀏覽器與多數應用都會跟隨，不需要管理員權限。",
      hintOff: "什麼都不執行。出口與分流會保留，下次啟動繼續用。",
      setup: "訂閱", subPlaceholder: "https://…/clash.yaml", save: "儲存", saved: "已儲存",
      setupHint: "Clash 或 mihomo 的訂閱（或設定檔）連結。下面的出口按節點名稱從訂閱裡挑選節點。",
      advanced: "進階", mirror: "下載鏡像", kernelPath: "核心路徑",
      mirrorHint: "放在核心 GitHub 下載地址前面的前綴，適合連 GitHub 較慢的網路。",
      kernelPathHint: "用你自己的 mihomo 執行檔，代替自動下載。",
      exits: "出口", addExit: "新增出口",
      exitLabel: "名稱（顯示在路徑圖上）", exitFilter: "節點名稱過濾（正規表示式）",
      typeUrlTest: "自動最快", typeSelect: "手動選擇", typeFallback: "故障轉移",
      add: "新增", cancel: "取消", remove: "刪除",
      exitHint: "出口保留其過濾命中的節點；除手動類型外，始終走其中最快的。節點來自訂閱。",
      noSub: "請先填寫訂閱：沒有訂閱，出口就沒有可選的節點。",
      providers: "Provider", providersHint: "magpie 服務各個 agent 用的 provider，以及每個 provider 的流量走哪個出口。常見 provider 的網域已內建，其餘的可以自行加入。",
      noProviders: "還沒有 provider：先在 magpie 的 Provider 頁新增。",
      noRule: "不分流", direct: "直連", default: "預設",
      domains: "網域", addDomain: "加入網域", domainPlaceholder: "api.example.com",
      flow: "路徑", animOn: "動畫", animOff: "靜止",
      flowNote: "為每個設定了出口的 provider 畫一條流動的路徑；流速跟隨今天的呼叫數，不代表實際流量。",
      footer: "核心隨 magpie 一起執行：上面的出口就是它的規則，虛擬網卡就是它的網卡。除你選擇的出口外，流量不會經過別處離開本機。",
      failed: "讀取失敗", removeDomain: "刪除網域",
      more: "還有 {n} 個",
      panelHint: "這個 provider 的流量從這裡出去：",
    },
    ja: {
      title: "トラフィック出口",
      modeTun: "仮想NIC", modeProxy: "システムプロキシ", modeOff: "オフ",
      hintTun: "mihomo が仮想ネットワークアダプタを動かし、各プロバイダのトラフィックを対応する出口へ渡します。初回起動時に管理者権限を一度だけ求めます（仮想NICに必要）。",
      hintProxy: "mihomo がローカルポートで動き、システムプロキシがそこを指します。ブラウザや多くのアプリがそれに従い、管理者権限は不要です。",
      hintOff: "何も動いていません。出口と経路は保存され、次回の起動で使われます。",
      setup: "サブスクリプション", subPlaceholder: "https://…/clash.yaml", save: "保存", saved: "保存しました",
      setupHint: "Clash か mihomo のサブスクリプション（またはプロファイル）URL。下の出口はノード名でそこからノードを選びます。",
      advanced: "詳細", mirror: "ダウンロードミラー", kernelPath: "カーネルのパス",
      mirrorHint: "カーネルの GitHub ダウンロード URL の前に置く前置文字列。GitHub が遅いネットワーク向け。",
      kernelPathHint: "自動ダウンロードの代わりに、自分の mihomo バイナリを使います。",
      exits: "出口", addExit: "出口を追加",
      exitLabel: "名前（経路図に表示）", exitFilter: "ノード名フィルタ（正規表現）",
      typeUrlTest: "最速", typeSelect: "手動", typeFallback: "フェイルオーバー",
      add: "追加", cancel: "キャンセル", remove: "削除",
      exitHint: "出口はフィルタに合うノードを集め、手動以外はその中で最速のものを使います。ノードはサブスクリプションから来ます。",
      noSub: "先にサブスクリプションを設定してください：それがないと出口に選べるノードがありません。",
      providers: "プロバイダ", providersHint: "magpie が各エージェントに使わせるプロバイダと、そのトラフィックが通る出口。主要プロバイダのドメインは内蔵し、それ以外は自分で追加できます。",
      noProviders: "プロバイダがまだありません：magpie のプロバイダページで追加してください。",
      noRule: "ルールなし", direct: "直接", default: "既定",
      domains: "ドメイン", addDomain: "ドメインを追加", domainPlaceholder: "api.example.com",
      flow: "経路", animOn: "アニメ", animOff: "静止",
      flowNote: "出口を持つプロバイダごとに流れを描きます。速さは今日の呼び数に従い、実際の通信量ではありません。",
      footer: "カーネルは magpie と一緒に動きます：上の出口がそのルール、仮想NICがそのアダプタです。選んだ出口以外からトラフィックが外へ出ることはありません。",
      failed: "読み込めませんでした", removeDomain: "ドメインを削除",
      more: "他 {n} 件",
      panelHint: "このプロバイダのトラフィックはここから出ます：",
    },
    de: {
      title: "Traffic-Exits",
      modeTun: "Virtueller Adapter", modeProxy: "Systemproxy", modeOff: "Aus",
      hintTun: "mihomo führt einen virtuellen Netzwerkadapter und gibt den Verkehr jedes Anbieters seinem Exit. Der erste Start fragt einmal nach Administratorrechten (der Adapter braucht sie).",
      hintProxy: "mihomo läuft auf einem lokalen Port, der Systemproxy zeigt darauf: Browser und die meisten Apps folgen, ohne Administratorrechte.",
      hintOff: "Nichts läuft. Exits und Routen bleiben gespeichert, bis zum nächsten Start.",
      setup: "Abo", subPlaceholder: "https://…/clash.yaml", save: "Sichern", saved: "Gesichert",
      setupHint: "Eine Clash- oder mihomo-Abo- (oder Profil-) URL. Die Exits unten wählen ihre Knoten nach Namen daraus.",
      advanced: "Erweitert", mirror: "Download-Spiegel", kernelPath: "Kernel-Pfad",
      mirrorHint: "Ein URL-Präfix vor dem GitHub-Download des Kernels, für Netze, in denen GitHub langsam ist.",
      kernelPathHint: "Eine eigene mihomo-Datei statt des Downloads.",
      exits: "Exits", addExit: "Exit hinzufügen",
      exitLabel: "Name (in der Karte)", exitFilter: "Knotennamen-Filter (regulärer Ausdruck)",
      typeUrlTest: "Schnellster", typeSelect: "Manuell", typeFallback: "Ausweich",
      add: "Hinzufügen", cancel: "Abbrechen", remove: "Entfernen",
      exitHint: "Ein Exit hält die Knoten, die sein Filter nennt, und nimmt außer bei manuell stets den schnellsten. Knoten kommen aus dem Abo.",
      noSub: "Zuerst ein Abo angeben: ohne eines hat ein Exit keine Knoten.",
      providers: "Anbieter", providersHint: "Die Anbieter, mit denen magpie Ihre Agents versorgt, und welchen Exit ihr Verkehr nimmt. Domains bekannter Anbieter sind dabei; die übrigen nehmen, was Sie hinzufügen.",
      noProviders: "Noch keine Anbieter: legen Sie einen auf magpies Anbieterseite an.",
      noRule: "Keine Regel", direct: "Direkt", default: "Vorgabe",
      domains: "Domains", addDomain: "Domain hinzufügen", domainPlaceholder: "api.example.com",
      flow: "Verlauf", animOn: "Animiert", animOff: "Still",
      flowNote: "Für jeden Anbieter mit Exit wird ein Fluss gezeichnet; sein Tempo folgt den heutigen Anrufen, nicht der Leitung.",
      footer: "Der Kernel läuft, solange magpie läuft: die Exits oben sind seine Regeln, der virtuelle Adapter seine Netzwerkkarte. Über nichts anderes als die gewählten Exits verlässt Verkehr diese Maschine.",
      failed: "Nicht geladen", removeDomain: "Domain entfernen",
      more: "+{n} weitere",
      panelHint: "Der Verkehr dieses Anbieters verlässt durch:",
    },
  }

  const MODES = ["tun", "proxy", "off"]

  // The catalog, the page's copy of manage/config.mjs's: the domains the
  // page shows for a provider before any were added. The test holds the
  // two files' copies together, so they cannot drift.
  const CATALOG = {
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

  // text reads the window's language the way magpie's own pages read it:
  // the exact code when the page has it, Chinese for any other zh code,
  // else English.
  function text(lang) {
    const key = STRINGS[lang] ? lang : /^zh/.test(String(lang ?? "")) ? "zh" : "en"
    return STRINGS[key] ?? STRINGS.en
  }

  // defaults are the options before anything was set; manage/config.mjs
  // keeps the same, and the test holds them together.
  function defaults() {
    return { mode: "off", subscription: "", defaultExit: "DIRECT", mirror: "", kernelPath: "", exits: [], routes: [] }
  }

  // cleanDomain is the page's copy of manage/config.mjs's toDomain.
  function cleanDomain(raw) {
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

  // domains of a provider: the catalog's first, then the route's own.
  function domains(catalog, provider, route) {
    const out = []
    for (const d of catalog?.[provider] ?? []) if (!out.includes(d)) out.push(d)
    for (const d of route?.domains ?? []) if (!out.includes(d)) out.push(d)
    return out
  }

  // hueOf colours an exit's nodes and packets the same on every open: the
  // name's hash, spread by the golden angle so neighbours in the list are
  // never neighbours in hue.
  function hueOf(key) {
    let h = 0
    for (const c of String(key)) h = (h * 31 + c.codePointAt(0)) % 360
    return Math.round((h * 137.508) % 360)
  }

  const MAX_ROWS = 10

  // flowLayout lies the map out: providers on the left, the exits (DIRECT,
  // each exit, the default) on the right, and one curve per routed
  // provider. Providers with an exit come first; the rest fill the rows
  // grey, without a curve.
  function flowLayout(providers, exits, routes, w, h) {
    const r = 7
    const right = [
      { key: "DIRECT", kind: "direct" },
      ...exits.map((e) => ({ key: e.id, kind: "exit", label: e.label })),
      { key: "@default", kind: "default" },
    ].map((n, i, all) => ({ ...n, x: w - 26, y: h * ((i + 0.5) / all.length) }))
    const routed = providers.filter((p) => routes.some((r) => r.provider === p.id))
    const shown = [...routed, ...providers.filter((p) => !routed.includes(p))].slice(0, MAX_ROWS)
    const left = shown.map((p, i) => ({ ...p, x: 26, y: h * ((i + 0.5) / shown.length) }))
    const byKey = new Map(right.map((n) => [n.key, n]))
    const links = []
    for (const l of left) {
      const route = routes.find((r) => r.provider === l.id)
      if (!route) continue
      const target = byKey.get(route.exit) ?? byKey.get("@default")
      links.push({
        provider: l.id, to: target.key, dim: route.exit === "" || !byKey.has(route.exit),
        d: `M ${l.x} ${l.y} C ${l.x + 48} ${l.y}, ${target.x - 48} ${target.y}, ${target.x} ${target.y}`,
      })
    }
    return { left, right, links, hidden: Math.max(0, providers.length - shown.length), r }
  }

  // spawnRate is how many packets a second the map breathes: a floor so it
  // is never dead, a climb with today's calls, a ceiling so it never panics.
  function spawnRate(prevCalls, calls) {
    const delta = Math.max(0, calls - prevCalls)
    return Math.min(8, 0.5 + delta * 0.9)
  }

  globalThis.TrafficView = { MODES, MAX_ROWS, CATALOG, text, defaults, cleanDomain, domains, hueOf, flowLayout, spawnRate }
})()
