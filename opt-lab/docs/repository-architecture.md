# 仓库产品边界

## 三个同级产品

仓库按产品目录拆分，工具源码不进入载体的 `web/`，也不再被工作台 iframe 包裹：

| 目录 | 产品 |
|---|---|
| `opt-lab/` | OPT / LAB Windows 优化工作台 |
| `cs2-sensitivity/` | CS2 灵敏度实验室 |
| `cs2-lineups/` | CS2 投掷物瞄点 |

- 仓库入口：根目录 `index.html` 三选板
- 网页工作台：`opt-lab/web/index.html`
- Windows 宿主：`opt-lab/src/OptLab.App/`，启动 `https://oplab.local/index.html`
- 共享契约与恢复记录：`opt-lab/src/OptLab.Core/`
- 受限本机 Broker：`opt-lab/src/OptLab.Broker/`

根入口负责选择产品，不承载某一个具体工具的业务实现。

## 运行时映射

源码保持同级；预览服务器和 WinUI 打包按产品目录提供页面：

- `index.html` → `/`
- `opt-lab/web/` → `/opt-lab/web/`
- `cs2-sensitivity/` → `/cs2-sensitivity/`
- `cs2-lineups/` → `/cs2-lineups/`

预览仍保留 `/modules/cs2-sensitivity/` 与 `/modules/cs2-lineups/` 别名。WinUI 资源按产品目录拷贝到 `Assets/`，不再放进 `Assets/Shell/modules/`。测试、文档和 README 不得打进 Windows Assets。

## 独立产品

CS2 灵敏度实验室位于 `cs2-sensitivity/`：

- `index.html` 是唯一正式实现和测试目标。
- `manifest.template.json` 描述模块 ID、入口、权限和签名占位。
- `legacy-share.html` 仅为旧分享场景保留，不作为正式校准算法来源。
- 校准历史保存在实验室自己的存储里，不再经外壳 iframe 记入运行记录。

CS2 投掷物瞄点位于 `cs2-lineups/`：

- `index.html` 是唯一正式实现。
- 不发送 `module.result`，不修改系统。

根目录的 `cs2-sensitivity-lab.html`、`cs2-sensitivity-friend.html` 和 `cs2-lineups-map.html` 只是旧地址兼容跳转。新代码、测试和打包不得重新依赖它们。

## 新模块约束

后续独立工具应作为仓库同级产品目录，并遵循以下边界：

1. 模块只负责界面、输入和声明式结果，不直接获得 Windows 权限。
2. 原生请求必须使用版本化宿主消息和编译内置白名单。
3. 写入型能力必须提供检测、快照、验证和恢复实现，未完成时保持禁用。
4. Windows 打包只收集选板、载体 `web/` 与各产品入口文件，不得从仓库根目录复制单独业务页面。
5. 浏览器预览结果不能替代 WinUI、WebView2、UAC、Broker 或签名验收。
