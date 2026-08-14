import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as yaml from 'js-yaml'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginInventoryGateway, { type PluginEntryId } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllEnvs()
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  ctx.loader.builtins.include = activePlugin
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory }
}

/** Brand a raw Loader entry id for the gateway's typed boundary. */
function branded(id: string): PluginEntryId {
  return id as PluginEntryId
}

/** One isolated harness home for the home-patch write tests. */
function homeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-inventory-'))
  vi.stubEnv('DSH_HOME', dir)
  return dir
}

describe('PluginInventoryGateway', () => {
  it('publishes one direct list method under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'setEnabled', invocation: { kind: 'direct' } },
    ])
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = inventory.list()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        fiberPhase: 'active',
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        fiberPhase: 'pending',
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        fiberPhase: null,
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('writes one enablement row into the home patch layer, replacing an earlier row for the same entry', async () => {
    const dir = homeDir()
    const { ctx, inventory } = await harness()
    const entryId = await ctx.loader.create({ name: 'cordis:active' })

    await expect(inventory.setEnabled(branded(entryId), false)).resolves.toEqual({ ok: true })
    expect(yaml.load(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'))).toEqual([
      { id: entryId, disabled: true },
    ])

    await expect(inventory.setEnabled(branded(entryId), true)).resolves.toEqual({ ok: true })
    expect(yaml.load(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'))).toEqual([
      { id: entryId, disabled: false },
    ])

    await expect(inventory.setEnabled(branded(entryId), false)).resolves.toEqual({ ok: true })
    const rows = yaml.load(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')) as unknown[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ id: entryId, disabled: true })
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps unrelated home patch rows while replacing the targeted one', async () => {
    const dir = homeDir()
    const { ctx, inventory } = await harness()
    const entryId = await ctx.loader.create({ name: 'cordis:active' })
    const unrelated = { id: 'mcp-codegraph', name: '@deepseek-ai/dsh-mcp-client' }
    writeFileSync(join(dir, 'cordis.patch.yml'), yaml.dump([unrelated]))

    await expect(inventory.setEnabled(branded(entryId), false)).resolves.toEqual({ ok: true })
    expect(yaml.load(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'))).toEqual([
      unrelated,
      { id: entryId, disabled: true },
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  it('targets the composition row id, not the prefixed runtime id of a nested tree entry', async () => {
    const dir = homeDir()
    const configDir = mkdtempSync(join(tmpdir(), 'dsh-plugin-inventory-tree-'))
    const configPath = join(configDir, 'cordis.yml')
    writeFileSync(configPath, yaml.dump([{ id: 'ui-skin', name: 'cordis:active' }]))

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    ctx.loader.builtins.active = activePlugin
    ctx.loader.builtins.include = Include
    await ctx.plugin(PluginInventoryGateway)
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    const inventory = ctx.get('pluginInventory') as PluginInventoryGateway

    const includeEntry = [...ctx.loader.entries()].find(entry => entry.options.name === 'cordis:include')
    const child = [...ctx.loader.entries()].find(entry => entry.options.id === 'ui-skin')
    expect(child).toBeDefined()
    expect(child!.id).toBe(`${includeEntry!.id}:ui-skin`)

    await expect(inventory.setEnabled(branded(child!.id), false)).resolves.toEqual({ ok: true })
    expect(yaml.load(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'))).toEqual([
      { id: 'ui-skin', disabled: true },
    ])
    rmSync(configDir, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an unknown entry id and the protected bootstrap include', async () => {
    homeDir()
    const { ctx, inventory } = await harness()
    await ctx.loader.create({ name: 'cordis:active' })

    await expect(inventory.setEnabled(branded('no-such-entry'), false)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unknown-entry' },
    })

    const includeId = await ctx.loader.create({ name: 'cordis:include' })
    await expect(inventory.setEnabled(branded(includeId), false)).resolves.toMatchObject({
      ok: false,
      error: { code: 'protected-entry' },
    })
  })

  it('fails loud on an unreadable home patch layer without overwriting it', async () => {
    const dir = homeDir()
    const { ctx, inventory } = await harness()
    const entryId = await ctx.loader.create({ name: 'cordis:active' })
    writeFileSync(join(dir, 'cordis.patch.yml'), 'not: [valid: yaml')

    await expect(inventory.setEnabled(branded(entryId), false)).resolves.toMatchObject({
      ok: false,
      error: { code: 'patch-read-failed' },
    })
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toBe('not: [valid: yaml')
    rmSync(dir, { recursive: true, force: true })
  })
})
