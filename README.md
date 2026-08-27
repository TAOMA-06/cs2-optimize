# OPT / LAB 仓库

本仓库按三个同级产品目录组织：

| 目录 | 产品 | 职责 |
|---|---|---|
| [`opt-lab/`](opt-lab/README.md) | OPT / LAB 载体 | Windows 游戏优化工作台外壳、WinUI 宿主、Broker 与开赛准备 |
| [`cs2-sensitivity/`](cs2-sensitivity/README.md) | CS2 灵敏度实验室 | 独立离线校准工具，也可由载体 iframe 加载 |
| [`cs2-lineups/`](cs2-lineups/README.md) | CS2 投掷物瞄点 | 独立离线雷达目录，也可由载体 iframe 加载 |

根目录 `index.html` 只负责进入载体。`cs2-sensitivity-lab.html`、`cs2-sensitivity-friend.html`、`cs2-lineups-map.html` 是旧地址兼容跳转，不是实现源文件。

工具源码不放进 `opt-lab/web/`。预览服务器和 Windows 打包在运行时把产品映射到 `/modules/<id>/`。

## 本地预览与检查

```bash
node scripts/serve-preview.mjs
node --test opt-lab/tests/*.test.mjs cs2-sensitivity/tests/*.test.mjs cs2-lineups/tests/*.test.mjs
node scripts/check-web.mjs
```

预览地址：

- 载体：http://127.0.0.1:4173/
- 灵敏度：http://127.0.0.1:4173/modules/cs2-sensitivity/
- 投掷物瞄点：http://127.0.0.1:4173/modules/cs2-lineups/

## Windows 构建

```powershell
dotnet build OptLab.sln -c Release -p:Platform=x64
```

当前 macOS 工作机未安装 .NET，也不能运行 WinUI/WebView2。Windows 打包、代码签名、Broker 服务安装及真实 UAC 流程必须在 Windows 设备上验收。

## 产品边界

- 载体只引用工具，不复制工具业务实现。
- 浏览器模块没有系统权限；灵敏度完成结果经 `module.result` 交给宿主校验。投掷物模块不发送校准结果。
- **尚未发布任何会修改 Windows、完美平台或游戏配置的自动化规则。**
