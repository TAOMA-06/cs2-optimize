# 仓库产品边界

## 主产品

本仓库的主产品是 OPT / LAB Windows 游戏优化工作台。

- 仓库入口：`index.html`
- 网页工作台：`web/index.html`
- Windows 宿主：`src/OptLab.App/`
- 共享契约与恢复记录：`src/OptLab.Core/`
- 受限本机 Broker：`src/OptLab.Broker/`

根入口只负责进入应用，不承载某一个具体工具的业务实现。

## 内置模块

CS2 灵敏度实验室位于 `web/modules/cs2-sensitivity/`，是应用的 `Calibration` 子模块：

- `index.html` 是唯一正式实现和测试目标。
- `manifest.template.json` 描述模块 ID、入口、权限和签名占位。
- `legacy-share.html` 仅为旧分享场景保留，不作为正式校准算法来源。

根目录的 `cs2-sensitivity-lab.html` 和 `cs2-sensitivity-friend.html` 只是旧地址兼容跳转。新代码、测试和打包不得重新依赖它们。

## 新模块约束

后续优化能力应放入 `web/modules/<module-id>/`，并遵循以下边界：

1. 模块只负责界面、输入和声明式结果，不直接获得 Windows 权限。
2. 原生请求必须使用版本化宿主消息和编译内置白名单。
3. 写入型能力必须提供检测、快照、验证和恢复实现，未完成时保持禁用。
4. Windows 打包统一收集 `web/**`，不得再从仓库根目录复制单独业务页面。
5. 浏览器预览结果不能替代 WinUI、WebView2、UAC、Broker 或签名验收。
