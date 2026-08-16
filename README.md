# OPT / LAB

面向 Windows 11 x64、兼容 Windows 10 x64 的本地优先游戏优化载体。首个模块承接现有 CS2 灵敏度实验室；开赛准备模块把 Windows、显卡、Steam、完美世界竞技平台与 5E 的可信步骤整理成适配方案。Windows 10 已结束常规支持，不能作为首选发布环境。

## 当前交付状态

- 可直接预览的产品外壳：总览、三分钟开赛准备、模块库、CS2 实验室、恢复中心、运行记录、设置。
- 开赛准备会按 Windows 版本、显卡品牌和游戏平台生成快速/完整方案，保存用户确认进度，并提供官方来源和验证步骤。
- Windows 宿主只允许打开编译内置的系统设置页和官方资料；网页不能构造任意 URI，也不会自行修改设置。
- 现有 `cs2-sensitivity-lab.html` 保持独立可离线打开；外壳以 iframe 承接其最终结果，不修改原始交互逻辑。
- Windows WinUI/WebView2 宿主、模块协议、事务日志和 Broker 源码骨架已建立。
- **尚未发布任何会修改 Windows、完美平台或游戏配置的自动化规则。** 自动化底座会拒绝未知动作，不能把架构代码误认为系统优化已生效。
- 当前 Broker 使用当前用户限定的本地命名管道，只发布只读机器摘要；管理员启动器、服务安装、代码签名和真实写入动作属于 Windows 发布门禁，尚未实现。

## 本地预览与检查

```bash
node scripts/serve-preview.mjs
node --test tests/core.test.mjs
node scripts/check-web.mjs
```

预览服务器会输出本机 URL。它只读取工作区文件，不上传任何数据。

## Windows 构建前提

在 Windows 上安装 .NET 10 SDK、Visual Studio 的 .NET Desktop Development 与 Windows App SDK/WinUI 工作负载，再执行：

```powershell
dotnet build OptLab.sln -c Release -p:Platform=x64
```

当前 macOS 工作机未安装 .NET，也不能运行 WinUI/WebView2；本次在这里验证的是网页外壳、模块桥接和跨平台核心逻辑。Windows 打包、代码签名、Broker 服务安装及真实 UAC 流程必须在 Windows 设备上验收。

## 安全模型

- 普通 UI 永远不以管理员身份运行。
- 网页模块只能经结构化消息与宿主通信，不能请求任意命令、脚本或可执行文件。
- Broker 只接受宿主编译进来的白名单动作；首版白名单只有诊断动作。
- 每个未来写入动作必须先记录原值、再应用、再验证；失败时逆序恢复，并在恢复中心留痕。
- 更新模块使用固定公钥验证的 detached RSA-PSS 签名；未签名模块不加载。

## 项目结构

- `web/`：可离线预览的产品外壳和模块承接层。
- `web/optimization-catalog.mjs`：截至 2026-08-15 的本地优化规则、适用条件与官方来源目录。
- `src/OptLab.App/`：Windows WinUI 3/WebView2 非管理员桌面宿主。
- `src/OptLab.Core/`：模块、签名与可恢复事务的共享契约。
- `src/OptLab.Broker/`：Windows 受限自动化 Broker；目前只暴露只读诊断动作。
- `cs2-sensitivity-lab.html`：已完成的独立 CS2 灵敏度工具，保留为模块源文件。
- `docs/cs2-optimization-research-2026-08-15.md`：研究证据、采纳规则和明确拒绝项。
