// The gateway entry: magpie imports this file once per host start, and runs
// onRequest on every request the gateway serves. The kernel is brought up
// from this file's top level and healed on each request, so it comes up
// with magpie and follows the exits the page saved, whatever restarted the
// host in between. The kernel itself runs detached and outlives this host.
import { ensureUp, ownOptions } from "./manage/kernel.mjs"

const PKG = "page-mihomo-exits"

function warn(e: unknown) {
  console.warn("[mihomo-exits]", e instanceof Error ? e.message : e)
}

// The host restarts when the page saves its options; this runs again then.
// The options are read from plugins.json, since the host hands them to the
// hook only once a request has come.
ownOptions(PKG).then((options) => ensureUp(options)).catch(warn)

// magpie hands the plugin's options to every request: a change saved on the
// page reaches the kernel within a few seconds, with no restart asked for.
// Returning undefined keeps the request as it came.
export async function onRequest(_body: unknown, ctx?: { options?: unknown }) {
  try {
    await ensureUp(ctx?.options as Record<string, unknown> | undefined)
  } catch (e) {
    warn(e)
  }
  return undefined
}
