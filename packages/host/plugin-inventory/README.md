# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

Host projection of the current Cordis Loader tree with home-layer enablement writes. `PluginInventoryGateway` registers the `pluginInventory` service and publishes two generated direct Remotes, `pluginInventory/list` and `pluginInventory/setEnabled`.

`pluginInventory/list` reads `ctx.loader.entries()` directly on every call, skips structural group rows, and returns the remaining entries in Loader order with only their Loader entry id, module specifier, effective enablement, and current root Fiber phase. The phase is `pending`, `loading`, `active`, `failed`, or `unloading`; it is `null` when the entry has no live root Fiber. The snapshot is intentionally point-in-time: Loader remains the sole lifecycle authority, while this package owns no cache, history, provenance model, or event stream.

`pluginInventory/setEnabled` persists one entry's enablement to the home patch layer (`$DSH_HOME/cordis.patch.yml`), which the running profile watches and hot-recomposes, so the change applies live without a restart. The write replaces any earlier home-layer row targeting the same entry id (one override per entry), keeps every other row, and fails loud on an unknown entry, the protected bootstrap `include` entry, or an unreadable/unwritable patch layer. Writes are serialized with the shared writer lock and committed atomically, so concurrent writers cannot interleave.

Its public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Model Experience

None, as this Host-only inventory projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time state only** — the snapshot contains no durable failure history or subscription; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **No provenance** — the service does not identify which bundle, profile, or override introduced an entry, and it cannot add or remove plugins, only toggle enablement.
- **Home layer rewrite** — `setEnabled` re-renders the whole home patch layer, so comments a user hand-wrote into `$DSH_HOME/cordis.patch.yml` are not preserved across a write.
