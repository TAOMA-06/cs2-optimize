# CS2 Sensitivity Module

这是独立的 CS2 灵敏度产品，也是 OPT / LAB 的校准子模块。源码不放在载体 `web/` 目录内。

- `index.html`：当前正式灵敏度实验室。开测前必须填写鼠标 DPI 与当前 CS2 灵敏度；命中靠左键点击确认，不再使用停留或连续跟枪。
- `manifest.template.json`：签名模块清单模板；占位哈希和签名不能用于发布。
- `legacy-share.html`：早期轻量分享版本，只为兼容既有使用场景保留。
- `tests/cs2-sensitivity-lab.test.mjs`：针对本产品内联脚本的测试。

模块不得直接获得 Windows 权限。完成结果通过版本化 `module.result` 消息交给 OPT / LAB 宿主再次校验和归档。
