# Agent Note：插件清单启用开关 —— Settings 里可以直接热切换插件行

Status: implemented

[English](2026-08-14-plugin-inventory-enable-switch.md) | 中文

## 问题

在 web 部署中启用或禁用插件，需要手工编辑 `cordis.patch.yml`（或 home 补丁），或运行 pnpm 级命令。设置 → 插件 → 插件列表这个界面是只读投影：`PluginInventoryGateway` 只发布 `pluginInventory/list`，客户端标签页只渲染状态标签与展开详情，没有任何修改控件。界面上没有一条路径可以拨动插件的启用状态，也没有一个写权威来维护运行中 profile 会热重载的 home 补丁层。

## 决策

两处协同改动，一个 Host Remote 加一个浏览器功能：

1. **`PluginInventoryGateway.setEnabled(entryId, enabled)`**（`@deepseek-ai/dsh-host-plugin-inventory`）。网关新增第二个生成的直接 Remote。它先在活 Loader 树中解析条目，然后在共享写锁与原子替换的保护下重写 home 补丁层（`$DSH_HOME/cordis.patch.yml`，即 `apps/cli` 已监视以实时重组的那份文件）：先移除任何早先针对同一条目 id 的 home 层行，使每个条目只保留一条覆盖，反复切换也不会累积行。其他条目的行保持不变；整个列表按 Loader 自己的 `entryListSchema` YAML 方言重渲染，并带一行简短的 managed-by 头。失败以显式业务结果返回（`unknown-entry`、`protected-entry`、`patch-read-failed`、`patch-write-failed`），且自举 `include` 条目受保护：切换它会废弃整个组合。
2. **插件列表标签页中的启用开关**（`@deepseek-ai/dsh-client-ui-settings-plugin-inventory`）。每张目录卡片增加一个 `role="switch"` 控件，通过既有的 `api-remotes` 组合调用新 Remote，并在成功后重新读取清单。写入待处理期间该行开关被禁用；写入被拒绝或失败时显示本地化提示，行状态保持不变（不做乐观翻转——呈现的状态始终来自 Host 快照）。

选择 home 层而非 profile 层，因为它是文档化的跨 profile 用户层，`dsh-skin` 生态已经通过 home 层禁用行管理皮肤，且它的监视器在 web profile 中已经激活。

### 对 Host 包形态的影响

`dsh-host-plugin-inventory` 从只读投影变为投影加写入包。其 README、`api-remotes` 组合 README 与包内 JSDoc 同步更新；包新增 `js-yaml`、`@deepseek-ai/cordis-plugin-include`（条目列表方言）、`@deepseek-ai/dsh-app-boot`（boot 使用的同一份 home 层读取器）、`@deepseek-ai/dsh-home-paths` 与 `@deepseek-ai/dsh-atomic-write` 作为声明的 peer/依赖。

## 后果

- **即时生效。** 运行中的 profile 监视 home 补丁文件（`watchUserPatches`），因此一次切换会在监视器周期内重组组合树；客户端 bundle 变化通过既有的 client-HMR 状态轮询热替换。开发态两侧都无需重启服务器；发布新 Host bundle 时仍按惯例需要重启。
- **每个条目一条覆盖。** 替换而非追加使文件在反复切换中保持稳定，并保留无关行；但整个文件会被重渲染，因此手工写在 home 补丁里的注释不会在写入后保留（已记录为限制）。
- **无 group 行。** `list` 跳过 group 条目，开关 UI 只能看到非 group 行；Remote 防御性地接受 group id（补丁行可以瞄准 group），但当前没有消费方会发送。
- **include 受保护。** `setEnabled` 双向拒绝自举 `include` 条目。

## 风险

**开关是一次部署级写入，没有撤销栈。** 重新启用就是同一个开关（该行被改写为 `disabled: false`），但用户如果禁用了某个插件又忘了是哪一个，可以查看 `$DSH_HOME/cordis.patch.yml`——该文件是唯一事实源且刻意保持人类可读。不保留额外日志；补丁文件本身就是日志。

**home 补丁重写会丢弃注释。** YAML 重渲染使用 Loader 方言，表达式与行都会保留；只有注释会丢失。managed-by 头标识写入者。
