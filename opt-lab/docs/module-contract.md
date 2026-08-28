# 模块与 Broker 契约

独立工具位于仓库同级产品目录。预览服务器按产品路径提供页面，并保留 `/modules/<module-id>/` 别名。WinUI 从选板做顶层导航，不再用 iframe 装载工具。

- CS2 灵敏度：源码 `cs2-sensitivity/index.html`，预览 `/cs2-sensitivity/`
- CS2 投掷物瞄点：源码 `cs2-lineups/index.html`，预览 `/cs2-lineups/`
- 优化工作台：源码 `opt-lab/web/index.html`，预览 `/opt-lab/web/`

根目录同名文件仅用于旧地址兼容，不得作为宿主、测试或打包来源。

## 模块边界

浏览器模块不获得原生系统权限。优化工作台只能向 WinUI 宿主发送下列版本化消息：

- `shell.ready`
- `settings.updated`
- `updates.check`
- `system.open-settings`
- `source.open`

宿主只向外壳返回以下消息：

- `host.context`：桌面模式、宿主版本、系统/架构摘要与逐项能力位。
- `host.acknowledged`：某个带 `requestId` 的请求已经由宿主真实完成。
- `host.error`：请求被白名单拒绝、格式无效或宿主未能完成；外壳不得提前显示成功。

普通浏览器没有可信宿主握手时，所有原生能力必须按关闭处理。浏览器预览可以查看诊断和恢复状态、保存网页本地偏好，但不得显示为 Windows 已连接。

灵敏度校准历史保存在实验室自己的存储中。外壳不再通过 iframe 读取或转写 `module.result`。

`system.open-settings` 只能提交宿主编译内置的 `pageId`；当前白名单仅包含高级显示、Game Mode、图形、电源、启动应用和 Windows Update。网页不能发送任意 URI。

`source.open` 只能提交研究目录中的 `sourceId`。宿主把它映射到编译内置的 HTTPS 官方资料，并在用户点击后交给默认浏览器；模块不能构造或导航到任意外部地址。

`host.context.capabilities` 当前只声明原生外壳、Windows 设置白名单、官方资料白名单和校准结果本机归档。Broker 诊断、签名更新和系统写入均为 `false`；网页不能自行抬高这些能力。

## 自动化边界

未来优化模块只能提交 `OptimizationPlan`，其中每一个 `ActionRequest` 只能引用编译进 Broker 的 ID。Broker 当前只发布 `oplab.diagnostics.machine-summary`，没有任何写入、进程结束、优先级、服务、注册表或命令执行动作。
