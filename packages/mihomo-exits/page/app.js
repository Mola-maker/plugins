// The page: reads providers:list and usage:summary (the two reads
// package.json declares), keeps everything the user sets in this plugin's
// own options, and draws the flow map: one curve per provider whose traffic
// has an exit, packets breathing along it at the pace of today's calls.
// Nothing here touches the network: everything goes through the bridge.
(async () => {
  const V = globalThis.TrafficView
  const Menu = globalThis.TrafficMenu
  const $ = (id) => document.getElementById(id)
  const NS = "http://www.w3.org/2000/svg"

  const theme = await magpie.ready
  let lang = theme.lang
  let opts = merge(await magpie.options.get().catch(() => ({})))
  const state = { providers: [], calls: null, anim: "on", reduce: matchMedia("(prefers-reduced-motion: reduce)").matches }

  function merge(raw) {
    const d = V.defaults()
    const o = raw && typeof raw === "object" ? raw : {}
    return {
      ...d,
      ...o,
      mode: V.MODES.includes(o.mode) ? o.mode : d.mode,
      exits: Array.isArray(o.exits) ? o.exits : [],
      routes: Array.isArray(o.routes) ? o.routes : [],
    }
  }
  const t = () => V.text(lang)

  function words() {
    const s = t()
    document.querySelectorAll("[data-t]").forEach((e) => { e.textContent = s[e.dataset.t] });
    $("subscription").placeholder = s.subPlaceholder
    $("exitLabel").placeholder = s.exitLabel
    $("exitFilter").placeholder = "(?i)US|United States|美国"
  }

  function select(group, attr, value) {
    $(group).querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset[attr] === value)))
  }

  // options can be set once a second: a burst of edits is saved with the
  // next tick, and the answer is read back as the truth
  let saving = null
  function save() {
    if (saving) return
    saving = setTimeout(async () => {
      saving = null
      try { opts = merge(await magpie.options.set(opts)) } catch {}
      paint()
    }, 1100)
  }

  const colorOf = (key) =>
    key === "DIRECT" ? "var(--muted)" : key === "@default" ? "var(--faint)" : `hsl(${V.hueOf(key)} 62% 55%)`

  function routeOf(id) {
    return opts.routes.find((r) => r.provider === id)
  }

  function setRoute(provider, exit) {
    const routes = opts.routes.filter((r) => r.provider !== provider)
    if (exit !== "") routes.push({ provider, exit, domains: routeOf(provider)?.domains ?? [] })
    opts = { ...opts, routes }
    save()
  }

  function exitLabel(exit) {
    const s = t()
    if (exit === "DIRECT") return s.direct
    const e = opts.exits.find((x) => x.id === exit)
    return e ? e.label : s.noRule
  }

  function exitMenu(anchor, provider) {
    const s = t()
    const options = [
      { value: "", label: s.noRule, hint: opts.defaultExit === "DIRECT" ? s.direct : exitLabel(opts.defaultExit) },
      { value: "DIRECT", label: s.direct },
      ...opts.exits.map((e) => ({ value: e.id, label: e.label, hint: e.filter })),
    ]
    Menu.open({
      anchor,
      value: routeOf(provider)?.exit ?? "",
      options,
      onPick: (v) => { setRoute(provider, v); paint() },
    })
  }

  function paint() {
    const s = t()
    select("modes", "mode", opts.mode)
    $("modeHint").textContent = s[`hint${opts.mode[0].toUpperCase()}${opts.mode.slice(1)}`]
    $("subscription").value = opts.subscription
    $("mirror").value = opts.mirror
    $("kernelPath").value = opts.kernelPath
    select("anim", "anim", state.anim)
    $("noSub").hidden = Boolean(opts.subscription) || opts.exits.length === 0
    paintExits(s)
    paintProviders(s)
    paintFlow(s)
  }

  function chip(domain, provider, removable) {
    const c = document.createElement("span")
    c.className = "chip" + (removable ? "" : " catalog")
    const x = document.createElement("span")
    x.textContent = domain
    c.append(x)
    if (removable) {
      const b = document.createElement("button")
      b.type = "button"
      b.title = t().removeDomain
      b.setAttribute("aria-label", `${t().removeDomain}: ${domain}`)
      b.textContent = "×"
      b.addEventListener("click", () => {
        const r = routeOf(provider)
        const routes = opts.routes.filter((x) => x.provider !== provider)
        routes.push({ provider, exit: r?.exit ?? "", domains: (r?.domains ?? []).filter((d) => d !== domain) })
        opts = { ...opts, routes }
        save()
        paint()
      })
      c.append(b)
    }
    return c
  }

  function paintExits(s) {
    const list = $("exitList")
    $("addExit").disabled = !opts.subscription
    list.replaceChildren(...opts.exits.map((e) => {
      const li = document.createElement("li")
      const main = document.createElement("div")
      main.className = "row-main"
      const dot = document.createElement("span")
      dot.className = "dot"
      dot.style.background = colorOf(e.id)
      const name = document.createElement("span")
      name.className = "name"
      name.textContent = e.label
      const grow = document.createElement("span")
      grow.className = "grow"
      const filter = document.createElement("span")
      filter.className = "chip"
      filter.style.maxWidth = "340px"
      filter.textContent = e.filter
      const kind = document.createElement("span")
      kind.className = "muted"
      kind.style.fontSize = "12px"
      kind.textContent = s[`type${e.type[0].toUpperCase()}${e.type.slice(1)}`]
      const rm = document.createElement("button")
      rm.type = "button"
      rm.className = "act danger"
      rm.textContent = s.remove
      rm.addEventListener("click", () => {
        opts = { ...opts, exits: opts.exits.filter((x) => x.id !== e.id) }
        save()
        paint()
      })
      main.append(dot, name, grow, filter, kind, rm)
      li.append(main)
      return li
    }))
  }

  function addDomain(provider) {
    const s = t()
    const route = routeOf(provider)
    const chips = document.querySelector(`div.chips[data-provider="${CSS.escape(provider)}"]`)
    if (!chips || chips.querySelector("input")) return
    const input = document.createElement("input")
    input.type = "text"
    input.placeholder = s.domainPlaceholder
    input.autocomplete = "off"
    input.spellcheck = false
    input.style.maxWidth = "180px"
    chips.append(input)
    input.focus()
    const done = (keep) => {
      const d = V.cleanDomain(input.value)
      if (keep && d) {
        const routes = opts.routes.filter((r) => r.provider !== provider)
        routes.push({ provider, exit: route?.exit ?? "", domains: [...(route?.domains ?? []), d] })
        opts = { ...opts, routes }
        save()
      }
      paint()
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(true)
      else if (e.key === "Escape") done(false)
    })
    input.addEventListener("blur", () => done(true))
  }

  function paintProviders(s) {
    const list = $("providerList")
    $("noProviders").hidden = state.providers.length > 0
    list.replaceChildren(...state.providers.map((p) => {
      const route = routeOf(p.id)
      const li = document.createElement("li")
      li.dataset.provider = p.id
      const main = document.createElement("div")
      main.className = "row-main"
      const name = document.createElement("span")
      name.className = "name"
      name.textContent = name.title = p.name
      const grow = document.createElement("span")
      grow.className = "grow"
      const menu = document.createElement("button")
      menu.type = "button"
      menu.className = "exit-btn"
      const dot = document.createElement("span")
      dot.className = "dot"
      const exit = route?.exit ?? ""
      dot.style.background = exit ? colorOf(exit) : "transparent"
      const lbl = document.createElement("span")
      lbl.className = "lbl"
      lbl.textContent = exit ? exitLabel(exit) : s.noRule
      menu.append(dot, lbl)
      menu.addEventListener("click", () => exitMenu(menu, p.id))
      main.append(name, grow, menu)
      li.append(main)

      const chips = document.createElement("div")
      chips.className = "chips"
      chips.dataset.provider = p.id
      for (const d of V.domains(V.CATALOG, p.id, route)) chips.append(chip(d, p.id, (route?.domains ?? []).includes(d)))
      const plus = document.createElement("button")
      plus.type = "button"
      plus.className = "chip"
      plus.title = s.addDomain
      plus.setAttribute("aria-label", `${s.addDomain} · ${p.name}`)
      plus.textContent = "+"
      plus.addEventListener("click", () => addDomain(p.id))
      chips.append(plus)
      li.append(chips)
      return li
    }))
  }

  // the flow map: static geometry first, then packets, which are circles
  // walked along each curve at a rate the usage poll drives
  let flow = null
  function paintFlow(s) {
    const svg = $("flow")
    const w = Math.max(320, svg.clientWidth || 640)
    const h = 240
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`)
    const layout = V.flowLayout(state.providers, opts.exits, opts.routes, w, h)
    flow = { layout, packets: [], last: performance.now(), acc: 0, rate: 0.6 }

    svg.replaceChildren()
    const defs = document.createElementNS(NS, "defs")
    svg.append(defs)
    for (const l of layout.links) {
      const p = document.createElementNS(NS, "path")
      p.setAttribute("d", l.d)
      p.setAttribute("class", "link" + (l.dim ? " dim" : ""))
      p.setAttribute("stroke", colorOf(l.to))
      svg.append(p)
    }
    for (const n of layout.left) {
      const g = group(n.x, n.y, colorOf("@default"), n.name, "start")
      svg.append(g)
    }
    for (const n of layout.right) {
      const label = n.key === "DIRECT" ? s.direct : n.key === "@default" ? s.default : n.label
      const g = group(n.x, n.y, colorOf(n.key), label, "end")
      g.setAttribute("class", `node-${n.kind}`)
      svg.append(g)
    }
    const legend = $("legend")
    legend.replaceChildren()
    const items = [
      ["var(--muted)", s.direct],
      ...opts.exits.map((e) => [colorOf(e.id), e.label]),
      ["var(--faint)", s.default],
    ]
    for (const [c, label] of items) {
      const span = document.createElement("span")
      const i = document.createElement("i")
      i.style.background = c
      span.append(i, document.createTextNode(label))
      legend.append(span)
    }
  }

  function group(x, y, color, label, side) {
    const g = document.createElementNS(NS, "g")
    const c = document.createElementNS(NS, "circle")
    c.setAttribute("cx", x)
    c.setAttribute("cy", y)
    c.setAttribute("r", 7)
    c.setAttribute("fill", color)
    c.setAttribute("fill-opacity", ".9")
    const tx = document.createElementNS(NS, "text")
    tx.setAttribute("x", side === "start" ? x + 12 : x - 12)
    tx.setAttribute("y", y + 4)
    tx.setAttribute("text-anchor", side === "start" ? "start" : "end")
    tx.textContent = label.length > 26 ? `${label.slice(0, 25)}…` : label
    g.append(c, tx)
    return g
  }

  // the breathing: each curve keeps its own packets; a packet is a circle
  // at a place along its curve, walked to the far end and dropped
  function tick(now) {
    if (state.anim === "on" && !state.reduce && flow) {
      const dt = Math.min(0.1, (now - flow.last) / 1000)
      flow.last = now
      // the credit for packets is capped, so a map that sat without links
      // doesn't fire a hundred of them the moment one appears
      flow.acc = Math.min(3, flow.acc + dt * flow.rate)
      const svg = $("flow")
      const paths = new Map([...svg.querySelectorAll("path.link")].map((p) => [p.getAttribute("d"), p]))
      while (flow.acc >= 1 && flow.layout.links.length) {
        flow.acc -= 1
        const link = flow.layout.links[Math.floor(Math.random() * flow.layout.links.length)]
        const path = paths.get(link.d)
        if (path) flow.packets.push({ d: link.d, path, at: 0, speed: 0.35 + Math.random() * 0.3 })
      }
      for (const p of flow.packets) p.at += p.speed * dt
      flow.packets = flow.packets.filter((p) => p.at < 1)
      svg.querySelectorAll(".packet").forEach((e) => e.remove())
      for (const p of flow.packets) {
        const at = p.path.getPointAtLength(p.at * p.path.getTotalLength())
        const c = document.createElementNS(NS, "circle")
        c.setAttribute("cx", at.x)
        c.setAttribute("cy", at.y)
        c.setAttribute("r", 2.4)
        c.setAttribute("fill", p.path.getAttribute("stroke"))
        c.setAttribute("class", "packet")
        c.setAttribute("opacity", "0.85")
        svg.append(c)
      }
    }
    requestAnimationFrame(tick)
  }

  async function load() {
    try {
      const got = (await magpie.read("providers:list")) ?? []
      if (JSON.stringify(got) !== JSON.stringify(state.providers)) {
        state.providers = got
        paint()
      }
      $("error").hidden = true
    } catch (e) {
      $("error").hidden = false
      $("error").textContent = `${t().failed}: ${e.message}`
    }
  }

  async function poll() {
    try {
      const s = await magpie.read("usage:summary", { period: "today" })
      if (state.calls !== null && flow) flow.rate = V.spawnRate(state.calls, s.calls ?? 0)
      state.calls = s.calls ?? 0
    } catch {}
  }

  // mode
  $("modes").addEventListener("click", (e) => {
    const m = e.target.closest("button")?.dataset.mode
    if (!m || m === opts.mode) return
    opts = { ...opts, mode: m }
    paint()
    save()
  })

  // subscription and the advanced fields
  const savedFlash = (b) => {
    const was = b.textContent
    b.textContent = t().saved
    setTimeout(() => { b.textContent = was }, 1200)
  }
  $("saveSub").addEventListener("click", () => {
    opts = { ...opts, subscription: $("subscription").value.trim(), mirror: $("mirror").value.trim(), kernelPath: $("kernelPath").value.trim() }
    savedFlash($("saveSub"))
    paint()
    save()
  })

  // exits: the add form
  let exitType = "url-test"
  $("exitType").addEventListener("click", (e) => {
    const v = e.target.closest("button")?.dataset.type
    if (v) { exitType = v; select("exitType", "type", v) }
  })
  $("addExit").addEventListener("click", () => {
    const form = $("exitForm")
    form.hidden = !form.hidden
    if (!form.hidden) { select("exitType", "type", exitType); $("exitLabel").focus() }
  })
  $("exitCancel").addEventListener("click", () => { $("exitForm").hidden = true })
  $("exitSave").addEventListener("click", () => {
    const label = $("exitLabel").value.trim()
    const filter = $("exitFilter").value.trim()
    if (!label || !filter) return
    opts = {
      ...opts,
      exits: [...opts.exits, { id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label, filter, type: exitType }],
    }
    $("exitLabel").value = ""
    $("exitFilter").value = ""
    $("exitForm").hidden = true
    save()
    paint()
  })

  // animation switch
  $("anim").addEventListener("click", (e) => {
    const v = e.target.closest("button")?.dataset.anim
    if (!v || v === state.anim) return
    state.anim = v
    paint()
  })

  // the map follows the window's width
  new ResizeObserver(() => paintFlow(t())).observe($("flow"))

  // "Traffic exit…" on a provider row's menu lands here
  magpie.onAction((data) => {
    if (data?.id !== "traffic-exit" || !data.provider?.id) return
    const row = document.querySelector(`li[data-provider="${CSS.escape(data.provider.id)}"]`)
    if (!row) return
    row.scrollIntoView({ block: "center", behavior: state.reduce ? "auto" : "smooth" })
    row.classList.remove("flash")
    requestAnimationFrame(() => row.classList.add("flash"))
  })

  magpie.onTheme((th) => {
    lang = th.lang
    words()
    paint()
  })

  words()
  paint()
  await load()
  await poll()
  setInterval(load, 10_000)
  setInterval(poll, 2_000)
  requestAnimationFrame(tick)
})()
