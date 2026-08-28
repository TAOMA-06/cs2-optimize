# OPT / LAB

OPT / LAB 是 Windows 游戏优化工作台。应用面向 Windows 11 x64、兼容 Windows 10 x64。它只处理本机诊断、恢复中心和设置，不再包含开赛准备，也不再把灵敏度和瞄点嵌进 iframe。Windows 10 已结束常规支持，不能作为首选发布环境。

网页工作台入口是 `web/index.html`。仓库根目录的 `index.html` 是三个同级产品的选板。

## 当前交付状态

- 独立优化工作台：总览、本机诊断、恢复中心和设置。
- Windows 宿主从选板启动，允许顶层导航到优化、灵敏度和瞄点三个产品路径。
- 外壳通过版本化握手区分 Windows 桌面宿主、浏览器预览和宿主失联；只有收到原生成功回执后才显示本机动作已完成。
- 本机诊断页只展示宿主主动提供的系统、架构、版本和能力边界，不扫描进程、平台账号或游戏文件。
- 灵敏度与瞄点源码分别位于仓库同级目录；载体不再通过 `/modules/<id>/` 把它们装进工作台。预览服务器仍保留该别名。
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
- 网页只能经结构化消息与宿主通信，不能请求任意命令、脚本或可执行文件。
- Broker 只接受宿主编译进来的白名单动作；首版白名单只有诊断动作。
- 每个未来写入动作必须先记录原值、再应用、再验证；失败时逆序恢复，并在恢复中心留痕。
- 更新模块使用固定公钥验证的 detached RSA-PSS 签名；未签名模块不加载。

## 目录

- `web/`：优化工作台界面，不含灵敏度或瞄点业务源码。
- `src/OptLab.App/`：Windows WinUI 3/WebView2 非管理员桌面宿主。
- `src/OptLab.Core/`：模块、签名与可恢复事务的共享契约。
- `src/OptLab.Broker/`：Windows 受限自动化 Broker；目前只暴露只读诊断动作。
- `tests/core.test.mjs`：工作台状态、宿主握手与研究目录测试。
- `docs/`：架构、模块契约、发布门禁与优化研究资料。
