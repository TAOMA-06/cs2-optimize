# CS2 Lineups 开发交接

- 更新时间：2026-08-27T17:20:00Z
- 当前分支：cursor/cs2-lineups-nav-stack-3377
- 当前 HEAD：pending-commit
- 总体状态：**导航改版已落地，浏览器与入口验收未完成；正式素材仍为 BLOCKED_EXTERNAL**
- 最后完成的阶段：点击式层级导航栈（代码已写入，验证尚未跑完）
- 唯一运行文件：`cs2-lineups/index.html`

## 已完成

- [x] 创建完全自包含的 `cs2-lineups/index.html`，CSS、JavaScript、地图结构与演示数据全部内嵌。
- [x] 实现 Mirage / Dust II 官方游戏雷达、手动位置点击、当前区域与相邻通路查询。
- [x] 实现 T/CT 各 5 个出生锚点、雷达圆点、内部编号和第一视角识别示意。
- [x] 实现 T/CT 各三个目标的个人开局路线、购买清单、手动步骤推进和新回合重置。
- [x] 加入全局醒目的“交互演示、未经实战验证”边界；所有演示条目使用 status: demo。
- [x] 确认页面没有游戏读取、网络请求、屏幕/OCR、WebView 或输入模拟 API。
- [x] 内嵌来自当前 CS2 游戏资源的 Mirage 与 Dust II 1024×1024 雷达底图；运行时不联网。
- [x] 为 Dust II 建立独立区域、出生点、起投站、演示瞄点与 T/CT 六类开局路线数据。
- [x] 将工作台式同屏布局改为单 HTML 导航栈：L0 地图 → L1 阵营 → L2 雷达 → L3 附近瞄点 → L4 详情；开局路线为雷达页同屏模式后的下级页面。
- [x] 现役 7 图目录（Cache / Mirage / Dust II / Inferno / Nuke / Ancient / Anubis）；仅 Mirage、Dust II 可进入。
- [x] Hash 路由、`history.pushState` / `replaceState`、v1→v2 本机状态迁移、详情不再使用 `<dialog>`。

## 正在进行

- [ ] NAV-001：点击式层级导航改版验收。
- 当前层：代码已写入 `cs2-lineups/index.html`；Node / `check-web` / 浏览器 / 三种入口尚未作为本轮正式证据记录。
- 已完成屏幕（实现，非浏览器证据）：L0 地图选择、L1 阵营、L2 雷达（附近/开局模式）、L3 附近列表、L4 详情、收藏页、开局目标/预览/步骤。
- 失败测试：尚无本轮测试记录。
- 下一步精确动作：运行 `node --test opt-lab/tests/*.test.mjs cs2-sensitivity/tests/*.test.mjs cs2-lineups/tests/*.test.mjs && node scripts/check-web.mjs && git diff --check`，再用预览服务器走五层路径、浏览器返回、360/844/1024/1440 视口，以及独立预览与 OPT / LAB iframe。file:// 仍不绕过浏览器限制。

## 未完成任务

| ID | 任务 | 当前状态 | 阻塞原因 | 下一步动作 | 涉及位置 | 完成标准 |
|---|---|---|---|---|---|---|
| NAV-001 | 点击式层级导航改版 | IN_PROGRESS | 五层路径、浏览器返回、移动端和三种入口还没有本轮真实证据 | 跑 Node/`check-web`，再用预览服务器记录桌面、移动视口、独立入口和 iframe | cs2-lineups/index.html、tests、scripts/check-web.mjs | 五层核心路径、浏览器返回、移动端和 file:// / 独立预览 / OPT-LAB iframe 均有真实证据；不得把演示数据写成实战瞄点验证 |
| CONTENT-001 | 正式 Mirage 瞄点目录 | BLOCKED_EXTERNAL | 工作区没有已授权站位图、瞄点图、落点图或结构化目录 | 用户提供授权素材包；按稳定 ID 嵌入并移除对应演示条目 | cs2-lineups/index.html 的 MAP_DATA.lineups | 24–30 条正式内容，媒体和元数据完整，无 demo 状态 |
| CONTENT-002 | 真实 T/CT 出生锚点与身位瞄点 | BLOCKED_EXTERNAL | 当前 10 个锚点是交互示意，不是当前游戏版本的实测出生池 | 提供当前 Mirage 版本的物理出生点、第一视角识别图和适配瞄点 | MAP_DATA.spawnAnchors、eligibleSpawnAnchorIds | 每个正式锚点可由雷达与视角图唯一识别，错误锚点不会得到精确推荐 |
| CONTENT-003 | 正式双阵营个人开局路线 | BLOCKED_EXTERNAL | 当前六类路线仅验证了状态机，没有实战连续性证据 | 提供或验收 T/CT 各 A/中/B 路线、购买清单、移动顺序和作者状态 | MAP_DATA.openingPlans | 所有正式路线引用正式瞄点，携带上限与连续步骤通过内容验收 |
| QA-001 | file:// 直接打开验证 | NOT_RUN | 自动化浏览器安全策略禁止访问本机 file:// URL，未采用绕过方式 | 用户或后续开发者双击 HTML，检查加载、地图点击、详情和本机存储 | cs2-lineups/index.html | Chrome/Edge/Safari 至少一个浏览器直接打开无控制台错误 |
| QA-002 | Safari、Edge 和真实手机验证 | NOT_RUN | 当前环境只能做 Chromium 预览与模拟视口 | 在目标设备执行相同主流程并记录截图/控制台 | 浏览器/设备外部门禁 | 目标浏览器主流程通过、无横向溢出、收藏与备注可恢复 |
| DUST2-001 | Dust II 正式瞄点内容 | PARTIAL_DEMO | 官方雷达、导航栈和演示目录已完成；正式授权瞄点素材未提供 | 提供 Dust II 正式三帧素材、出生锚点证据和开局路线 | DUST2_DATA | 正式内容替换全部 demo 条目，并通过内容验收 |

## 验证记录

| 命令或场景 | 结果 | 是否通过 | 证据或错误摘要 |
|---|---|---|---|
| 本轮 Node 测试 | 尚未作为正式证据运行 | 未运行 | 提交后执行 |
| node scripts/check-web.mjs | 尚未作为正式证据运行 | 未运行 | 已加入导航屏、manifest 0.2.0 与旧工作台结构移除断言 |
| git diff --check | 尚未作为正式证据运行 | 未运行 | 提交后执行 |
| 五层核心路径浏览器 | 尚未运行 | 未运行 | 需要预览服务器实测 |
| 浏览器返回顺序 | 尚未运行 | 未运行 | 详情 → 附近 → 雷达 → 阵营 → 地图 |
| 独立预览 / OPT-LAB iframe / file:// | 尚未运行 | 未运行 | file:// 不绕过安全限制 |
| 360×800 / 844×390 / 1024×768 / 1440×900 | 尚未运行 | 未运行 | 不得恢复地图+侧栏 |

先前工作台式布局的浏览器记录仍然只证明旧交互，不能当作本轮导航改版完成证据，也不能当作实战瞄点验证。

## 素材与外部输入

### 已收到

- Mirage 和 Dust II 官方游戏雷达图已从公开的游戏资源镜像取得、压缩为 WebP 并内嵌。
- 雷达资源镜像说明其内容自动提取自 Valve 官方游戏 depot；资产权利归 Valve Corporation。
- 无正式 Mirage / Dust II 瞄点媒体或结构化目录。
- Cache / Inferno / Nuke / Ancient / Anubis 仅有离线目录卡示意缩略图，不是游戏内雷达或实战素材。

### 缺少

- 24–30 条瞄点的稳定 ID、阵营、道具类型、起投位置、目标位置、投法和战术用途。
- 每条瞄点的站位图、瞄点图、落点/效果图。
- 当前版本 T/CT 物理出生锚点与每个锚点的第一视角识别图。
- 精确出生点与瞄点的关联表。
- T/CT 各 A/中/B 个人开局路线及连续性/作者确认信息。
- 每项媒体的公开作者名、授权范围引用、内容日期和允许的修改/内嵌范围。

### 不得伪造的内容

- 不得把当前 SVG 示意画面或目录卡称为游戏截图。
- 不得把 demo 条目改为“已验证”。
- 不得凭距离自动猜测出生点专属瞄点。
- 不得把零散瞄点临时拼成正式开局路线。
- 不得声称 Safari、Edge、真实手机或 file:// 已通过。
- 不得把导航通过、浏览器通过或演示数据写成实战瞄点验证。

## 已知问题与风险

1. 当前交付是完整交互原型，不是可依赖的实战道具库。
2. 当前区域多边形、出生锚点和投掷物标点仍是交互演示，需要针对官方雷达逐项校准后才能成为正式内容。
3. 详情三帧现在明确显示“素材未提供”，不再生成假游戏截图。
4. 单文件嵌入 24–30 条三帧高清媒体会明显增加 HTML 体积；正式嵌入前应先压缩为 WebP，并报告最终文件大小。
5. file:// 下各浏览器的本机存储策略可能不同，需要至少一个目标浏览器人工验证。
6. 地图、出生池或投掷行为变化后，正式内容必须转为 needs-review，不能继续进入默认推荐。

## 接手步骤

1. 首先读取本交接文档，禁止只依赖聊天记录。
2. 运行第一条命令：git status --short --branch
3. 运行基线：node --test opt-lab/tests/*.test.mjs cs2-sensitivity/tests/*.test.mjs cs2-lineups/tests/*.test.mjs && node scripts/check-web.mjs
4. 打开的第一个文件：cs2-lineups/index.html
5. 优先处理任务：NAV-001 浏览器与入口证据；正式内容仍是 CONTENT-001，状态为 BLOCKED_EXTERNAL
6. 导航函数以 `CS2LineupsCore` / `CS2LineupsApp` 为准；事件处理器不得直接改 hash 字段。
7. 每替换一批内容就运行内联脚本语法、禁止 API、现有测试、浏览器主流程和控制台检查。
8. 结束前更新本交接文档的时间、HEAD、工作区状态、验证结果和所有未完成任务。
