import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}

/** Failure codes for one rejected enablement write. */
export type PluginInventorySetFailureCode =
  /** The entry is no longer present in the Loader tree. */
  | 'unknown-entry'
  /** The entry is the bootstrap include, which owns the whole composition. */
  | 'protected-entry'
  /** The home patch layer could not be read. */
  | 'patch-read-failed'
  /** The home patch layer could not be written. */
  | 'patch-write-failed'

/** Detail of one rejected enablement write. */
export interface PluginInventorySetFailure {
  readonly code: PluginInventorySetFailureCode
  readonly message: string
}

/** One plugin-entry enablement write outcome, returned by `pluginInventory.setEnabled`. */
export type PluginInventorySetResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: PluginInventorySetFailure }
