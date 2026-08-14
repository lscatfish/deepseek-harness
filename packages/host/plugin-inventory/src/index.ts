/** Projection of the current Cordis Loader plugin entries plus home-layer enablement writes. */

import { join } from 'node:path'
import * as yaml from 'js-yaml'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { PROFILE_PATCH_FILENAME, loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySetResult,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Diagnostic prefix shared with the boot glue's own patch readers. */
const NAME = 'dsh'

/** One-line header keeping a machine-managed home patch layer self-describing. */
const HOME_PATCH_HEADER = '# Managed by the dsh web plugin inventory (Settings → Plugins); keep this file YAML-compatible.\n'

/** Whether one patch row targets `entryId` as a plain id-targeted override (not an insert). */
function patchTargetsId(patch: PatchOptions, entryId: string): boolean {
  return patch.insert === undefined && patch.id === entryId
}

/** Render the next home patch layer in the Loader's own YAML dialect. */
function renderPatchList(patches: readonly PatchOptions[]): string {
  return HOME_PATCH_HEADER + yaml.dump([...patches], { schema: entryListSchema, noRefs: true })
}

/** A home patch layer that could not be parsed; distinguishes read from write failures. */
class PatchReadError extends Error {}

/** Remote service exposing the Loader's current non-group entry state and home-layer enablement writes. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    return { entries }
  }

  /**
   * Persist one entry's enablement to the home patch layer
   * (`$DSH_HOME/cordis.patch.yml`). The running profile watches that file and
   * recomposes the tree, so the change applies live. Any earlier home-layer
   * row targeting the same entry id is replaced, keeping the file free of
   * duplicate overrides.
   * @param entryId - the Loader-tree entry id to target (the client-visible
   * runtime id, which may carry the containing tree's prefix).
   * @param enabled - the desired effective enablement.
   * @returns success, or an explicit failure for an unknown or protected
   * entry, or an unreadable/unwritable patch layer.
   */
  @Remote('setEnabled')
  async setEnabled(entryId: PluginEntryId, enabled: boolean): Promise<PluginInventorySetResult> {
    for (const entry of this.ctx.loader.entries()) {
      if (entry.id !== entryId) continue
      if (entry.options.name === 'cordis:include') {
        return {
          ok: false,
          error: { code: 'protected-entry', message: 'the bootstrap include entry cannot be toggled' },
        }
      }
      // Patches address the stable composition row id; the runtime entry id
      // may be prefixed by the containing tree (e.g. `include:ui-skin-x`).
      const rowId = entry.options.id || entryId
      const patchPath = join(resolveDshHome(), PROFILE_PATCH_FILENAME)
      try {
        await withFileLock(patchPath, async () => {
          let patches: PatchOptions[]
          try {
            patches = loadOptionalPatches(NAME, patchPath) ?? []
          } catch (cause) {
            throw new PatchReadError(`home patch layer ${patchPath} is unreadable or invalid: ${String(cause)}`)
          }
          const next = [...patches.filter(patch => !patchTargetsId(patch, rowId)), { id: rowId, disabled: !enabled }]
          await writeFileAtomic(patchPath, renderPatchList(next), { mode: 0o600 })
        })
        return { ok: true }
      } catch (error) {
        if (error instanceof PatchReadError) {
          return { ok: false, error: { code: 'patch-read-failed', message: error.message } }
        }
        return { ok: false, error: { code: 'patch-write-failed', message: String(error) } }
      }
    }
    return { ok: false, error: { code: 'unknown-entry', message: `no loader entry ${entryId}` } }
  }
}

export default PluginInventoryGateway
