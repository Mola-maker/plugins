// A menu in the window's manner. The kernel's ui.menu is out of reach for
// a sandboxed page, so the page draws its own: one at a time, opened below
// its anchor, closed by picking, Escape or a click outside, walked with
// the arrow keys, announced as a listbox the way magpie's own are.
(() => {
  let live = null

  function close() {
    if (!live) return
    const { root, onOutside, onKey } = live
    root.remove()
    document.removeEventListener("pointerdown", onOutside, true)
    document.removeEventListener("keydown", onKey, true)
    live = null
  }

  // open({anchor, value, options, onPick}) draws one menu and answers a
  // function that closes it. options is [{value, label, hint?}].
  function open({ anchor, value, options, onPick }) {
    close()
    const root = document.createElement("div")
    root.className = "menu"
    root.setAttribute("role", "listbox")
    const buttons = []
    let index = Math.max(0, options.findIndex((o) => o.value === value))
    for (const o of options) {
      const b = document.createElement("button")
      b.type = "button"
      b.setAttribute("role", "option")
      b.setAttribute("aria-selected", String(o.value === value))
      const label = document.createElement("span")
      label.textContent = o.label
      b.append(label)
      if (o.hint) {
        const h = document.createElement("small")
        h.textContent = o.hint
        b.append(h)
      }
      b.addEventListener("click", () => {
        close()
        onPick?.(o.value)
      })
      root.append(b)
      buttons.push(b)
    }
    const move = (to) => {
      index = (to + buttons.length) % buttons.length
      for (const [i, b] of buttons.entries()) b.classList.toggle("focus", i === index)
      buttons[index]?.focus()
    }
    root.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); move(index + 1) }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(index - 1) }
      else if (e.key === "Enter") { e.preventDefault(); buttons[index]?.click() }
      else if (e.key === "Escape") { e.preventDefault(); close(); anchor?.focus() }
    })
    document.body.append(root)

    // below the anchor, never past the frame's edges
    const a = anchor?.getBoundingClientRect?.()
    root.style.visibility = "hidden"
    const r = root.getBoundingClientRect()
    if (a) {
      root.style.left = `${Math.max(8, Math.min(a.left, document.documentElement.clientWidth - r.width - 8))}px`
      root.style.top = `${a.bottom + 4 + r.height > document.documentElement.clientHeight && a.top - r.height - 4 >= 8 ? a.top - r.height - 4 : a.bottom + 4}px`
    }
    root.style.visibility = ""

    const onOutside = (e) => { if (!root.contains(e.target)) { close(); } }
    const onKey = (e) => { if (e.key === "Escape") { close(); anchor?.focus() } }
    document.addEventListener("pointerdown", onOutside, true)
    document.addEventListener("keydown", onKey, true)
    live = { root, onOutside, onKey }
    buttons[index]?.focus()
    return close
  }

  globalThis.TrafficMenu = { open, close }
})()
