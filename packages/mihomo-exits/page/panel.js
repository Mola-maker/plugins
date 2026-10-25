// The panel in a provider's editor: this provider's exit, picked from the
// same list the page's rows pick from, and saved into the same options.
// magpie tells the panel which provider it sits under (magpie.context).
(async () => {
  const V = globalThis.TrafficView
  const Menu = globalThis.TrafficMenu
  const $ = (id) => document.getElementById(id)

  await magpie.ready
  const provider = magpie.context?.provider?.id
  let lang = magpie.theme?.lang ?? "en"
  let opts = merge(await magpie.options.get().catch(() => ({})))

  function merge(raw) {
    const d = V.defaults()
    const o = raw && typeof raw === "object" ? raw : {}
    return { ...d, ...o, exits: Array.isArray(o.exits) ? o.exits : [], routes: Array.isArray(o.routes) ? o.routes : [] }
  }
  const t = () => V.text(lang)
  const route = () => opts.routes.find((r) => r.provider === provider)
  const colorOf = (key) => (key === "DIRECT" ? "var(--muted)" : `hsl(${V.hueOf(key)} 62% 55%)`)

  let saving = null
  function save() {
    if (saving) return
    saving = setTimeout(async () => {
      saving = null
      try { opts = merge(await magpie.options.set(opts)) } catch {}
      paint()
    }, 1100)
  }

  function paint() {
    const s = t()
    document.querySelectorAll("[data-t]").forEach((e) => { e.textContent = s[e.dataset.t] })
    if (!provider) {
      $("note").textContent = s.noProviders
      $("exitBtn").disabled = true
      return
    }
    const exit = route()?.exit ?? ""
    $("exitLbl").textContent = exit === "DIRECT" ? s.direct : exit ? (opts.exits.find((e) => e.id === exit)?.label ?? s.noRule) : s.noRule
    $("exitDot").style.background = exit ? colorOf(exit) : "transparent"
    const domains = V.domains(V.CATALOG, provider, route())
    $("domains").textContent = domains.join(" · ")
  }

  $("exitBtn").addEventListener("click", () => {
    if (!provider) return
    const s = t()
    Menu.open({
      anchor: $("exitBtn"),
      value: route()?.exit ?? "",
      options: [
        { value: "", label: s.noRule, hint: opts.defaultExit === "DIRECT" ? s.direct : (opts.exits.find((e) => e.id === opts.defaultExit)?.label ?? s.noRule) },
        { value: "DIRECT", label: s.direct },
        ...opts.exits.map((e) => ({ value: e.id, label: e.label, hint: e.filter })),
      ],
      onPick: (v) => {
        const routes = opts.routes.filter((r) => r.provider !== provider)
        if (v !== "") routes.push({ provider, exit: v, domains: route()?.domains ?? [] })
        opts = { ...opts, routes }
        save()
        paint()
      },
    })
  })

  magpie.onTheme((th) => { lang = th.lang; paint() })
  paint()
})()
