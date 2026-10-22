# LayerFS for Magpie

[LayerFS](https://github.com/Ephemeral-AI-Lab/layerfs) workspaces for every
agent [magpie](https://usemagpie.ai) connects: instead of each agent copying
a project tree to work on it, agents share one durable, deduplicated history
and work through **stable filesystem paths**. Forking a branch for a
parallel agent copies **no file bytes**; a checkpoint stores **only what
changed**; any agent can resolve, read and build on what the others
committed.

给每个 agent 的 LayerFS 工作区：多个 agent 共享一份可去重的持久历史，而不是
各自复制整棵项目树。给并行 agent 开分支不复制任何文件字节；存检查点只写
变化的部分；路径稳定，任何 agent 都能定位、读取并接续其他 agent 的提交。

```sh
magpie plugin add @magpie-community/tools-layerfs
magpie plugin            # lists layerfs_provision, layerfs_checkpoint, ...
```

## Tools

Served on magpie's MCP server as `layerfs_<tool>`:

| Tool | What it does |
|---|---|
| `provision` | Gives the agent a workspace for a project branch and answers the path to work in. The first provision imports the source directory — a required argument, the directory the user chose for the project — as the project's first checkpoint; later provisions of the same branch answer the same path without copying the tree again. |
| `checkpoint` | Saves the workspace's state on its branch, storing only the blobs the store has not seen; answers added / modified / deleted counts and the new-bytes vs saved-bytes accounting. |
| `fork` | Forks a branch for a parallel agent: a pointer at an existing checkpoint, ready immediately, 0 bytes copied. |
| `publish` | Publishes a branch's head as main's new Layer, so finished work becomes what new work forks from. Guarded: main's head must be in the branch's history, so a publish can only move main forward — if main moved on its own, the publish is refused (a real dsh run lost main's 238 tests to a stale publish; this is that lesson, encoded). `force: true` overwrites deliberately and reports what it replaced. |
| `exec` | Runs a shell command in a branch's workspace and checkpoints whatever it changed as one commit — the dsh shape, where every bash call is mount, run, commit. A no-change command commits nothing; a failing command's changes are still checkpointed, with its exit code reported. **Disabled by default** (see Safety defaults): it runs only when the user has opted in. |
| `history` | Lists a branch's checkpoints, newest first, with each one's logical tree size and the bytes it actually stored. |
| `resolve` | Resolves a project / branch / file to a real filesystem path, its checkpoint and content hash — an O(1) lookup, no copying. |
| `status` | Backend in use, projects and branches held, and the storage accounting: logical bytes of all checkpoints vs bytes the store occupies. |

Only the workspace path is persistent. Every workspace carries two
scratch directories, `.tmp/` and `.cache/`, created at provision;
`exec` runs commands with `TMPDIR` and `XDG_CACHE_HOME` redirected at
them, so toolchains keep their temporary files and caches inside the
workspace instead of the host's real `/tmp`. Both directories are
workspace-local scratch: checkpoints and publishes never capture them,
and they live and die with the workspace directory itself. Files a
command writes to the host's real `/tmp` are likewise outside LayerFS
management — if it matters, it belongs in the workspace.

## Backend

- **sim** — a local content-addressed store implementing the LayerFS
  model: immutable blobs named by SHA-256, branches as manifest
  pointers, checkpoints as deduplicated manifests, under
  `MAGPIE_LAYERFS_HOME` (default `~/.magpie-layerfs`). It runs
  anywhere, which is what the tests and the benchmark below use.

**This package is sim-only.** The native backend — the real LayerFS
through its JavaScript SDK — is developed in the standalone repo,
[Mola-maker/magpie-layerfs](https://github.com/Mola-maker/magpie-layerfs),
and is not part of this package: shipping it here needs a pinned,
integrity-checked npm dependency, and `@layerfs/sdk` is not
published to npm, so there is no version to pin. It returns in a
follow-up PR once the SDK is published. Asking for it
(`MAGPIE_LAYERFS_BACKEND=native`, `MAGPIE_LAYERFS_NATIVE=1`, or the
old `"native"` plugin option) is an explicit error that says so.

`MAGPIE_LAYERFS_BACKEND=auto|sim` selects explicitly; both mean sim
here.

## Safety defaults

magpie serves plugin tools on its MCP server to any caller holding a
gateway key, and the plugin host runs with the user's rights — so the
defaults here are set for that room, not for a private library:

- **`provision`'s `source` is required.** There is no default: an
  earlier version defaulted it to the host's `directory`, which in
  magpie is the *config* directory (`~/.config/magpie`) — it holds
  `plugin-auth.json`, every signed-in plugin's token. The config
  directory, the credential stores (`~/.ssh`, `~/.aws`, `~/.gnupg`),
  the home directory, the filesystem root, and the plugin's own store
  are refused as a source — as the source, inside it, or containing
  it. The comparison runs on real paths (`realpathSync`, case-folded),
  so neither a symlink pointing at a refused directory nor a
  case-variant spelling of one (`~/.Config/Magpie`, `~/.AWS`) gets
  past it.
- **Secret-shaped files never enter the store from an import**:
  `.git`, `.env*`, private keys (`id_rsa`, `id_ed25519`, `*.pem`,
  `*.key`, …), `.ssh`, `.aws`. The import skips them and reports how
  many. Imports are also bounded (20,000 files / 512 MiB) and fail
  loudly past the limit instead of sweeping a disk.
- **The store is private.** Its root and directories are created
  `0700`, its record files `0600`, whatever the umask says; a file's
  own mode is preserved through the store (a `0600` file is stored
  and materialized as `0600`).
- **`exec` is disabled by default.** It runs a shell with the plugin
  host's privileges; a model key should not silently become host
  shell access. The user enables it with the plugin's `"exec"`
  option (set to `true` in magpie's plugin options) or
  `MAGPIE_LAYERFS_EXEC=1` in the host's environment.
- **Re-provisioning never wipes a workspace.** When a branch has
  moved since its workspace was materialized, provision keeps the
  workspace's files and reports `stale: true` instead of deleting
  uncheckpointed work.

## Benchmark

[`bench/bench.mjs`](https://github.com/Mola-maker/magpie-layerfs/blob/main/bench/bench.mjs)
(run from a checkout of this repo) — a 184-file, 26.8 MB project; 6
parallel agents, each keeping 3 checkpoints (sim backend, this machine):

| | naive copies | this plugin |
|---|---|---|
| fork one more agent | 321 ms, 26.8 MB copied | **~1 ms, 0 bytes** |
| keep 18 checkpoints | 482.6 MB of snapshots | **27.2 MB** of store for 509.4 MB of logical checkpoints (**18.7× dedup**) |
| resolve a file path | walk the copy's tree | **138 µs**, with its checkpoint + SHA-256 |
| total disk for the run | 643.5 MB | **188.1 MB** (store + the 6 live workspaces) |

![test run](https://raw.githubusercontent.com/Mola-maker/magpie-layerfs/29b52fb98fc2e9c20fb9e5c3c85a05f80cd01754/docs/assets/tests.png)
![benchmark](https://raw.githubusercontent.com/Mola-maker/magpie-layerfs/29b52fb98fc2e9c20fb9e5c3c85a05f80cd01754/docs/assets/benchmark.png)

Honest limits: a first provision still materializes the tree once, and the
sim backend rehashes the tree at each checkpoint (the native engine tracks
changes through its daemons instead). What the plugin removes is the
per-agent copy, the per-snapshot copy, and the bytes they waste — the
engine's own benchmarks are at
[layerfs.ai/benchmarks](https://layerfs.ai/benchmarks/).

The same scenario against the real engine (the native backend, in
the standalone repo): the engine's store file held **5.6 MB for
513 MB of logical checkpoints** on a compressible text fixture —
the sim fixture above is random bytes, the incompressible extreme, so
read the two ratios as the ends of a range, not a single number.

## The page: watch the trajectory

The package also declares a magpie page, **LayerFS trajectory**
(轨迹), which replays how the agents' worktrees grew, drawn the way
LayerFS's own History picture draws them: main is the green middle
bough, each branch a bough of its own, a checkpoint a badge bearing
its agent's own icon — the marks magpie itself ships for them, in
that agent's colour — a fork a split, and a publish a graft back
onto main that adds a Layer band (L0, L1, …). Two running totals
carry the argument — what those checkpoints would have cost as
plain copies against what the deduplicated store actually wrote,
with a store.stats line in LayerFS's own accounting words. Play it,
scrub it, click a badge for its checkpoint's message and byte
split, or click a branch's name tag to focus that branch alone:
that is what the plugin does for an agent's edits, made visible.

The page is drawn in magpie's own design language and built the way
magpie builds pages — plain HTML, CSS and scripts, no build step and
no dependencies, styled by the host's `--magpie-*` theme tokens with
its tiles, seg controls and indigo accent. The replay runs on
requestAnimationFrame through magpie's own `--ease` curve
(cubic-bezier(.2,.8,.2,1)): the boughs draw themselves as the
playhead passes, each badge lands with a pulse while its icon
draws its own outline and fills in, a publish pops its Layer badge
(L1, L2, …) onto main, and the stat tiles count up with the same
easing; with reduced motion preferred, the page simply shows the
finished picture, every icon fully drawn.

A magpie page cannot read plugin-private data: its sandbox forbids
fetch, and the bridge's reads are a fixed host list (`usage:summary`,
`providers:list`) with no entry a plugin can serve its own data
through. So the page animates the sample bundled with it —
`page/trajectory.js`, a labeled recording from the benchmark scenario
(one project, six agents, three checkpoints each), a package asset
that nothing rewrites at runtime. The trajectory itself is computed
on demand from the store's records whenever it is asked for
(`backend.trajectory()`; `tools/gen-trajectory.mjs` uses it to make
the sample). No recording file is maintained per tool call: an
earlier version refreshed one in the store after every call, which
cost a branch-chain walk per call — growing with the project's
history — for a file the page cannot read, so the refresh was
removed in 0.7.1. The page declares no `magpie.read` permissions,
and its test asserts it asks for none.

## Develop

From a checkout of
[magpie-community/plugins](https://github.com/magpie-community/plugins),
in `packages/layerfs`:

```sh
bun test                 # the suite (bun:test): tools end to end, plus the page's layout math
```

The benchmark above and the sample-trajectory generator live in the
standalone repo,
[Mola-maker/magpie-layerfs](https://github.com/Mola-maker/magpie-layerfs),
which is also where the native backend is developed.

Zero runtime dependencies; the arguments are JSON Schema, like the other
tools packages. MIT.

## Changes in 0.7.1

The second round of the PR #318 review — the holes it found in
0.7.0's own new code, plus its smaller items:

- **This package is sim-only.** The native backend was removed from
  the magpie-community package (the review's condition for keeping
  it — a pinned, integrity-checked npm dependency — cannot exist
  while `@layerfs/sdk` is not on npm). It lives in the standalone
  repo and returns in a follow-up PR once the SDK is published with
  a version to pin; asking for it here is an explicit error.
  `package.json`'s `repository` now names this repo, with
  `"directory": "packages/layerfs"`, like every other package here.
- **The source guard compares real paths now.** 0.7.0 compared
  `resolve()`d strings, which a symlink to a refused directory — or
  a case-variant spelling of one on a case-insensitive volume —
  walked straight past (the review imported `plugin-auth.json`
  through `~/.Config/Magpie` and through a symlink). Both sides are
  canonicalized with `realpathSync` and case-folded; refused roots
  that do not exist are canonicalized through their nearest existing
  ancestor. Regression tests cover the symlink and the case variant,
  unit-level and end to end.
- **Breaking on-disk change: workspaces moved, branch encoding
  widened.** Workspaces now live at `workspaces/<project>/<encoded
  branch>` — the flat `<project>--<branch>` name was not injective
  (project `a` branch `b--c` and project `a--b` branch `c` shared one
  directory, and a checkpoint crossed the projects). The branch
  encoder now percent-encodes every character outside `[a-z0-9._-]`,
  uppercase included, so `Main` and `main` no longer share a head
  file or a workspace on case-insensitive volumes either. Stores are
  **not migrated**: branch head files are unchanged for names the old
  encoder already spelled the same way (lowercase, `_`, `-`, `.`,
  and `/`→`%2F`); a branch whose name contains uppercase or `%`
  keeps its commits but its old head file (`branches/Main.json`)
  and old workspace (`workspaces/<project>--Main`) are not picked
  up — re-fork such branches, and remove the old workspace
  directories by hand.
- **No per-call trajectory refresh.** The `trajectory.json` the
  tools maintained in the store after every call is gone: keeping it
  current cost a walk of the touched branch's whole chain per call,
  for a file the page cannot read. `trajectory()` still builds the
  same data on demand.
- **`exec`'s plumbing**: stdin is closed (a command reading it gets
  EOF instead of waiting out the timeout), the child runs detached
  in its own process group and a timeout kills the group, and the
  call resolves on `exit` plus a short drain instead of `close` —
  a background child holding the stdout pipe can no longer hold the
  call open past its shell.
- **Manifests are counted.** `storedBytes`/`dedupRatio` now include
  the commit records — each checkpoint's full manifest — which for
  a wide tree are a real share of the store (the review measured
  128 MB of manifests for 200 checkpoints of a 5,000-file tree,
  previously uncounted, under a description claiming history "costs
  little more than the changes themselves"; the description now
  states the real cost model). Stores written before 0.7.1 keep
  their incremental record, which undercounts by the records written
  before this version until the record is rebuilt (delete
  `accounting.json` to force the rebuild walk).
- The page's README images are pinned to a commit instead of the
  moving `main`.

## Changes in 0.7.0

A safety pass over the whole package (prompted by the PR #318 review):

- `provision` requires `source` explicitly and refuses magpie's config
  directory and the credential stores as sources; imports skip
  secret-shaped files (sim) or refuse them (native), and are bounded.
- `exec` is off by default; the user's `"exec"` plugin option or
  `MAGPIE_LAYERFS_EXEC=1` turns it on.
- The native backend is off by default (the `"native"` option or
  `MAGPIE_LAYERFS_NATIVE=1`) and runs entirely in a child process
  (`native-worker.mjs`); the host process imports no SDK and shares no
  `LAYERFS_*` environment writes.
- A native checkpoint no longer deletes binaries it skipped at
  checkout; re-provisioning a moved native branch reports `stale`
  instead of wiping the workspace; native publish refuses when the
  fork point or main's top Layer is unknown.
- The store and workspaces are `0700`, record files `0600`, and file
  modes are preserved through the sim store.
- The recorded trajectory lives in the store (`trajectory.json`),
  refreshed per affected project; the page's bundled file is a static
  sample, and running the test suite modifies no package file.
- **Breaking on-disk change**: branch head files and workspace
  directories now percent-encode `/` (`feat/x` → `feat%2Fx`), so slash
  branches and `feat__x` no longer collide and slash branches list
  correctly. Stores written by 0.6.x keep working for non-slash
  branches; a slash branch's old head file (`branches/feat/x.json`)
  and workspace (`feat__x`) are not migrated — re-fork slash branches.
- The page gained Japanese and Traditional Chinese string tables
  (matching its declared titles), a magpie-style project menu in
  place of the native `<select>`, and a branch-colour dot on the
  detail card in place of the coloured edge.
