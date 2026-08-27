# OPT / LAB

OPT / LAB 是 Windows 游戏优化工作台载体。应用面向 Windows 11 x64、兼容 Windows 10 x64。CS2 灵敏度实验室和投掷物瞄点是独立产品目录，由本载体在运行时加载。开赛准备把 Windows、显卡、Steam、完美世界竞技平台与 5E 的可信步骤整理成适配方案。Windows 10 已结束常规支持，不能作为首选发布环境。

网页工作台入口是 `web/index.html`。仓库根目录的 `index.html` 会跳转到这里。

## 当前交付状态

- 可直接预览的复合产品外壳：总览流程中心、三分钟开赛准备、模块库、CS2 实验室、投掷物瞄点、本机诊断、恢复中心、运行记录和设置。
- 开赛准备会按 Windows 版本、显卡品牌和游戏平台生成快速/完整方案，保存用户确认进度，并提供官方来源和验证步骤。
- Windows 宿主只允许打开编译内置的系统设置页和官方资料；网页不能构造任意 URI，也不会自行修改设置。
- 外壳通过版本化握手区分 Windows 桌面宿主、浏览器预览和宿主失联；只有收到原生成功回执后才显示本机动作已完成。
- 总览把环境确认、快速检查、灵敏度基线和恢复状态串成一条可继续的开赛流程；环境变化会使先前确认自动失效。
- 本机诊断页只展示宿主主动提供的系统、架构、版本和能力边界，不扫描进程、平台账号或游戏文件。
- 灵敏度与投掷物源码分别位于仓库同级目录；载体只通过 `/modules/<id>/` 加载，不把工具实现放进 `web/`。
- Windows WinUI/WebView2 宿主、模块协议、事务日志和 Broker 源码骨架已建立。
- **尚未发布任何会修改 Windows、完美平台或游戏配置的自动化规则。** 自动化底座会拒绝未知动作，不能把架构代码误认为系统优化已生效。
- 当前 Broker 使用当前用户限定的本地命名管道，只发布只读机器摘要；管理员启动器、服务安装、代码签名和真实写入动作属于 Windows 发布门禁，尚未实现。

## 本地预览与检查

在仓库根目录执行：

```bash
node scripts/serve-preview.mjs
node --test opt-lab/tests/*.test.mjs cs2-sensitivity/tests/*.test.mjs
node scripts/check-web.mjs
```

## Windows 构建前提

在 Windows 上安装 .NET 10 SDK、Visual Studio 的 .NET Desktop Development 与 Windows App SDK/WinUI 工作负载，再执行：

```powershell
dotnet build OptLab.sln -c Release -p:Platform=x64
```

## 安全模型

- 普通 UI 永远不以管理员身份运行。
- 网页模块只能经结构化消息与宿主通信，不能请求任意命令、脚本或可执行文件。
- Broker 只接受宿主编译进来的白名单动作；首版白名单只有诊断动作。
- 每个未来写入动作必须先记录原值、再应用、再验证；失败时逆序恢复，并在恢复中心留痕。
- 更新模块使用固定公钥验证的 detached RSA-PSS 签名；未签名模块不加载。

## 目录

- `web/`：载体外壳，不含工具业务源码。
- `src/OptLab.App/`：Windows WinUI 3/WebView2 非管理员桌面宿主。
- `src/OptLab.Core/`：模块、签名与可恢复事务的共享契约。
- `src/OptLab.Broker/`：Windows 受限自动化 Broker；目前只暴露只读诊断动作。
- `tests/core.test.mjs`：外壳状态与开赛规则测试。
- `docs/`：架构、模块契约、发布门禁与开赛研究。
