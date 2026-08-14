# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

当前 Cordis Loader 树的 Host 投影，带 home 层启用状态写入。`PluginInventoryGateway` 注册 `pluginInventory` 服务，并发布两个由 Typert 生成的直接 Remote：`pluginInventory/list` 与 `pluginInventory/setEnabled`。

`pluginInventory/list` 每次调用都直接读取 `ctx.loader.entries()`，跳过结构性的 group 行，再按 Loader 顺序返回其余条目，并且只包含 Loader 条目 id、模块标识、有效启用状态与当前根 Fiber 阶段。阶段为 `pending`、`loading`、`active`、`failed` 或 `unloading`；条目没有存活的根 Fiber 时则为 `null`。该快照刻意只表示调用当下：Loader 仍是唯一的生命周期权威，本包不拥有缓存、历史、来源模型或事件流。

`pluginInventory/setEnabled` 把某条目的启用状态持久化到 home 补丁层（`$DSH_HOME/cordis.patch.yml`）。运行中的 profile 会监视该文件并热重组组合，因此改动无需重启即生效。写入会替换 home 层中任何早先针对同一条目 id 的行（每个条目只有一条覆盖），保留其余所有行，并在遇到未知条目、受保护的自举 `include` 条目或不可读/不可写的补丁层时明确失败。写入通过共享写锁串行化并以原子方式提交，并发写者不会交错。

公开 payload 类型位于 `./types`，Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.md) 组合消费它，而不导入 Host 实现。

## 模型体验

无，因为这个仅限 Host 的清单投影不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **仅表示调用当下** —— 快照不包含持久的失败历史或订阅；只要不存在存活的根 Fiber，就会报告 `null`，而不区分其原因。
- **无来源能力** —— 服务不识别条目由哪个 bundle、profile 或 override 引入，也不能添加或移除插件，只能切换启用状态。
- **home 层整文件重写** —— `setEnabled` 会重渲染整个 home 补丁层，用户手工写在 `$DSH_HOME/cordis.patch.yml` 里的注释在写入后不会保留。
