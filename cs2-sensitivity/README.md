# CS2 Sensitivity Module

这是 OPT / LAB 的内置灵敏度子模块，不是仓库主应用入口。

- `index.html`：当前正式灵敏度实验室，可独立离线打开，也由桌面工作台通过 iframe 加载。
- `manifest.template.json`：签名模块清单模板；占位哈希和签名不能用于发布。
- `legacy-share.html`：早期轻量分享版本，只为兼容既有使用场景保留。

模块不得直接获得 Windows 权限。完成结果通过版本化 `module.result` 消息交给 OPT / LAB 宿主再次校验和归档。
