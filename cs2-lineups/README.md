# CS2 Lineups

这是独立的 CS2 投掷物瞄点产品，也是 OPT / LAB 的只读参考子模块。源码不放在载体 `web/` 目录内。

- `index.html`：当前正式运行文件，可独立离线打开，也由桌面工作台通过 `/modules/cs2-lineups/` 加载。
- `manifest.template.json`：`kind=Reference` 的模块清单模板；占位哈希和签名不能用于发布。
- `tests/cs2-lineups.test.mjs`：导航栈、hash 路由、邻区查询与 v1→v2 迁移测试。
- `docs/handoff.md`：内容验收、素材阻塞与验证记录。

模块不申请系统权限，不发送 `module.result`。收藏与备注只保存在本机浏览器存储。当前目录仍含交互演示条目，未经实战验收前不得当作正式瞄点。
