# 模块与 Broker 契约

## 模块边界

浏览器模块不获得原生系统权限。它们只能向 WinUI 宿主发送下列版本化消息：

- `shell.ready`
- `module.opened`
- `module.result`
- `settings.updated`
- `updates.check`

`module.result` 的 CS2 载荷必须包含 `moduleId=cs2-sensitivity`、`sensitivity`、`command` 与完成时间。宿主再次检查 `0.100–8.000` 范围和 `sensitivity ` 命令前缀，才写入本机历史。

## 自动化边界

未来优化模块只能提交 `OptimizationPlan`，其中每一个 `ActionRequest` 只能引用编译进 Broker 的 ID。Broker 当前只发布 `oplab.diagnostics.machine-summary`，没有任何写入、进程结束、优先级、服务、注册表或命令执行动作。

要加入一个真实系统动作，实施任务必须同时提供：

1. 兼容性与前置条件检查。
2. 写入前的原值快照。
3. 应用后的独立验证。
4. 反向恢复实现和中断恢复测试。
5. 签名模块清单、风险说明与 Windows 10/11 回归结果。

没有这五项的规则不得进入公开 Beta。
