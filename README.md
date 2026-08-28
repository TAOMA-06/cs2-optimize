# OPT / LAB 仓库

本仓库按三个同级产品目录组织，入口是选板，不再互相包裹：

| 目录 | 产品 | 职责 |
|---|---|---|
| [`opt-lab/`](opt-lab/README.md) | Windows 优化工作台 | 本机诊断、恢复中心、设置，以及 WinUI 宿主与 Broker |
| [`cs2-sensitivity/`](cs2-sensitivity/README.md) | CS2 灵敏度实验室 | 独立离线校准工具 |
| [`cs2-lineups/`](cs2-lineups/README.md) | CS2 投掷物瞄点 | 独立离线雷达目录 |

根目录 `index.html` 是三选板。`cs2-sensitivity-lab.html`、`cs2-sensitivity-friend.html`、`cs2-lineups-map.html` 是旧地址兼容跳转，不是实现源文件。

灵敏度和瞄点不再嵌进优化工作台 iframe。预览服务器仍保留 `/modules/<id>/` 别名，以免旧书签断开。

## 本地预览与检查

```bash
node scripts/serve-preview.mjs
node --test opt-lab/tests/*.test.mjs cs2-sensitivity/tests/*.test.mjs
node scripts/check-web.mjs
```

预览地址：

- 选板：http://127.0.0.1:4173/
- 优化：http://127.0.0.1:4173/opt-lab/web/
- 灵敏度：http://127.0.0.1:4173/cs2-sensitivity/
- 投掷物瞄点：http://127.0.0.1:4173/cs2-lineups/

## Windows 构建

```powershell
dotnet build OptLab.sln -c Release -p:Platform=x64
```

当前 macOS 工作机未安装 .NET，也不能运行 WinUI/WebView2。Windows 打包、代码签名、Broker 服务安装及真实 UAC 流程必须在 Windows 设备上验收。

## 产品边界

- 三个产品各自有可打开的 `index.html`，WinUI 同一个窗口用顶层导航在选板与三个产品之间切换。
- 优化工作台不包含开赛检查清单，也不加载另外两个工具。
- **尚未发布任何会修改 Windows、完美平台或游戏配置的自动化规则。**
