# 模块与 Broker 契约

正式内置模块统一位于 `web/modules/<module-id>/`。CS2 灵敏度模块的规范入口是 `web/modules/cs2-sensitivity/index.html`；根目录同名文件仅用于旧地址兼容，不得作为宿主、测试或打包来源。

## 模块边界

浏览器模块不获得原生系统权限。它们只能向 WinUI 宿主发送下列版本化消息：

- `shell.ready`
- `module.opened`
- `module.result`
- `settings.updated`
- `updates.check`
- `system.open-settings`
- `source.open`

宿主只向外壳返回以下消息：

- `host.context`：桌面模式、宿主版本、系统/架构摘要与逐项能力位。
- `host.acknowledged`：某个带 `requestId` 的请求已经由宿主真实完成。
- `host.error`：请求被白名单拒绝、格式无效或宿主未能完成；外壳不得提前显示成功。

普通浏览器没有可信宿主握手时，所有原生能力必须按关闭处理。浏览器预览可以运行离线模块、保存网页本地进度和复制操作路径，但不得显示为 Windows 已连接。

`module.result` 的 CS2 载荷必须包含 `moduleId=cs2-sensitivity`、`sensitivity`、`command` 与完成时间。宿主再次检查 `0.100–8.000` 范围和 `sensitivity ` 命令前缀，才写入本机历史。

`system.open-settings` 只能提交宿主编译内置的 `pageId`；当前白名单仅包含高级显示、Game Mode、图形、电源、启动应用和 Windows Update。网页不能发送任意 URI。

`source.open` 只能提交研究目录中的 `sourceId`。宿主把它映射到编译内置的 HTTPS 官方资料，并在用户点击后交给默认浏览器；模块不能构造或导航到任意外部地址。

`host.context.capabilities` 当前只声明原生外壳、Windows 设置白名单、官方资料白名单和校准结果本机归档。Broker 诊断、签名更新和系统写入均为 `false`；网页不能自行抬高这些能力。

## 自动化边界

未来优化模块只能提交 `OptimizationPlan`，其中每一个 `ActionRequest` 只能引用编译进 Broker 的 ID。Broker 当前只发布 `oplab.diagnostics.machine-summary`，没有任何写入、进程结束、优先级、服务、注册表或命令执行动作。

要加入一个真实系统动作，实施任务必须同时提供：

1. 兼容性与前置条件检查。
2. 写入前的原值快照。
3. 应用后的独立验证。
4. 反向恢复实现和中断恢复测试。
5. 签名模块清单、风险说明与 Windows 10/11 回归结果。

没有这五项的规则不得进入公开 Beta。
