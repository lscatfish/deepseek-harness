# Agent Note: Plugin inventory enablement switch — Settings can toggle plugin rows live

Status: implemented

English | [中文](2026-08-14-plugin-inventory-enable-switch.zh.md)

## Problem

Enabling or disabling a plugin in the web deployment required editing `cordis.patch.yml` (or the home patch) by hand, or running pnpm-level commands. The Settings → Plugins → Plugin list surface was a read-only projection: `PluginInventoryGateway` published only `pluginInventory/list`, and the client tab rendered status tags and disclosure details with no mutation control. There was no in-GUI path to flip a plugin's enablement, and no single write authority for the home patch layer that the running profile hot-reloads.

## Decision

Two coordinated changes, one Host Remote and one browser feature:

1. **`PluginInventoryGateway.setEnabled(entryId, enabled)`** (`@deepseek-ai/dsh-host-plugin-inventory`). The gateway gains a second generated direct Remote. It resolves the entry in the live Loader tree, then rewrites the home patch layer (`$DSH_HOME/cordis.patch.yml`, the file `apps/cli` already watches for live recomposition) under the shared writer lock with an atomic replacement: any earlier home-layer row targeting the same entry id is removed first, so each entry keeps exactly one override and repeated toggles never accumulate rows. Rows for other entries are preserved; the whole list is re-rendered in the Loader's own `entryListSchema` YAML dialect with a short managed-by header. Failures are explicit business results (`unknown-entry`, `protected-entry`, `patch-read-failed`, `patch-write-failed`), and the bootstrap `include` entry is protected: toggling it would strand the whole composition.
2. **Enablement switch in the Plugin list tab** (`@deepseek-ai/dsh-client-ui-settings-plugin-inventory`). Each catalog card gains a `role="switch"` control that calls the new Remote through the existing `api-remotes` assembly and refetches the inventory on success. The row's switch is disabled while the write is pending; a rejected or failed write surfaces a localized alert and leaves row state untouched (no optimistic flip — the applied state always comes from the Host snapshot).

The home layer was chosen over the profile layer because it is the documented cross-profile user layer, the `dsh-skin` ecosystem already manages skins through home-layer disable rows, and its watcher is already active in the web profile.

### Effect on the Host package's shape

`dsh-host-plugin-inventory` changes from a read-only projection to a projection-plus-write package. Its README, the `api-remotes` assembly README, and the package JSDoc updated accordingly; the package gains `js-yaml`, `@deepseek-ai/cordis-plugin-include` (entry-list dialect), `@deepseek-ai/dsh-app-boot` (the exact home-layer reader the boot uses), `@deepseek-ai/dsh-home-paths`, and `@deepseek-ai/dsh-atomic-write` as declared peers/dependencies.

## Consequences

- **Live application.** The running profile watches the home patch file (`watchUserPatches`), so a toggle recomposes the tree within the watcher cycle; the client bundle change hot-swaps through the existing client HMR stat poll. No server restart is required for either half in dev, though a rebuilt Host bundle needs the usual restart when shipping.
- **One override per entry.** Replacing rather than appending keeps the file stable across repeated toggles and preserves unrelated rows, but the whole file is re-rendered, so hand-written comments in the home patch are not preserved across a write (documented limitation).
- **No group rows.** `list` skips group entries and the switch UI only sees non-group rows; the Remote accepts a group id defensively (a patch row can target a group), but no current consumer sends one.
- **Protected include.** `setEnabled` rejects the bootstrap `include` entry in both directions.

## Risks

**The toggle is a deployment-wide write with no undo stack.** Re-enabling is the same switch (the row is rewritten with `disabled: false`), but a user who disables a plugin and forgets which one disabled it can consult `$DSH_HOME/cordis.patch.yml` — the file is the single source of truth and is intentionally human-readable. No additional journal is kept; the patch file itself is the journal.

**Home patch rewrites drop comments.** The YAML re-render is the Loader dialect, so expressions and rows survive; only comments are lost. The managed-by header identifies the writer.
