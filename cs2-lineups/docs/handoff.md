# CS2 Lineups 开发交接

- 更新时间：2026-08-27T17:37:21Z
- 当前分支：cursor/cs2-lineups-nav-stack-3377
- 已验证代码提交：a92c7b3111c434508382734e402c68d52ef5ea6b
- 交接文档提交：本文件随后续 docs 提交进入同一分支
- 总体状态：**导航改版在 Chromium 预览、独立模块入口、OPT / LAB iframe 与 file:// 自动化下已通过；正式瞄点素材仍为 BLOCKED_EXTERNAL**
- 最后完成的阶段：点击式层级导航栈（NAV-001，Chromium 证据）
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
- [x] NAV-001：五层核心路径、浏览器返回、360/844/1024/1440 视口、file:// / 独立预览 / OPT-LAB iframe 均有 Chromium 真实证据。

## 正在进行

- 无进行中的导航实现任务。
- 当前层：NAV-001 已完成（Chromium）。下一优先任务仍是 CONTENT-001，状态 BLOCKED_EXTERNAL。
- 已完成屏幕（实现 + Chromium 证据）：L0 地图选择、L1 阵营、L2 雷达（附近/开局模式）、L3 附近列表、L4 详情、开局出生点。开局目标/预览/步骤有自动化断言，无单独截图。
- 失败测试：本轮 Node 100/100、`check-web`、`git diff --check`、Chromium 31/31 均通过。
- 下一步精确动作：等待授权正式瞄点/出生点/开局素材；在 Safari、Edge 和真实手机上补 QA-002。不要把 demo 条目改成已验证。

## 未完成任务

| ID | 任务 | 当前状态 | 阻塞原因 | 下一步动作 | 涉及位置 | 完成标准 |
|---|---|---|---|---|---|---|
| NAV-001 | 点击式层级导航改版 | COMPLETE | 无。Safari / Edge / 真机仍见 QA-002，不回退本任务 | 无代码动作；后续只修回归 | cs2-lineups/index.html、tests、scripts/check-web.mjs | 五层核心路径、浏览器返回、移动端和 file:// / 独立预览 / OPT-LAB iframe 均有真实证据；不得把演示数据写成实战瞄点验证 |
| CONTENT-001 | 正式 Mirage 瞄点目录 | BLOCKED_EXTERNAL | 工作区没有已授权站位图、瞄点图、落点图或结构化目录 | 用户提供授权素材包；按稳定 ID 嵌入并移除对应演示条目 | cs2-lineups/index.html 的 MAP_DATA.lineups | 24–30 条正式内容，媒体和元数据完整，无 demo 状态 |
| CONTENT-002 | 真实 T/CT 出生锚点与身位瞄点 | BLOCKED_EXTERNAL | 当前 10 个锚点是交互示意，不是当前游戏版本的实测出生池 | 提供当前 Mirage 版本的物理出生点、第一视角识别图和适配瞄点 | MAP_DATA.spawnAnchors、eligibleSpawnAnchorIds | 每个正式锚点可由雷达与视角图唯一识别，错误锚点不会得到精确推荐 |
| CONTENT-003 | 正式双阵营个人开局路线 | BLOCKED_EXTERNAL | 当前六类路线仅验证了状态机，没有实战连续性证据 | 提供或验收 T/CT 各 A/中/B 路线、购买清单、移动顺序和作者状态 | MAP_DATA.openingPlans | 所有正式路线引用正式瞄点，携带上限与连续步骤通过内容验收 |
| QA-001 | file:// 直接打开验证 | COMPLETE_CHROMIUM | Safari / Edge 人工双击仍未跑 | 用户可在目标浏览器双击 HTML 做人工复核 | cs2-lineups/index.html | Chrome/Edge/Safari 至少一个浏览器直接打开无控制台错误。本轮 Chromium `file:///workspace/cs2-lineups/index.html` 已加载 7 张地图卡并进入 `#/maps` |
| QA-002 | Safari、Edge 和真实手机验证 | NOT_RUN | 当前环境只能做 Chromium 预览与模拟视口 | 在目标设备执行相同主流程并记录截图/控制台 | 浏览器/设备外部门禁 | 目标浏览器主流程通过、无横向溢出、收藏与备注可恢复 |
| DUST2-001 | Dust II 正式瞄点内容 | PARTIAL_DEMO | 官方雷达、导航栈和演示目录已完成；正式授权瞄点素材未提供 | 提供 Dust II 正式三帧素材、出生锚点证据和开局路线 | DUST2_DATA | 正式内容替换全部 demo 条目，并通过内容验收 |

## 验证记录

| 命令或场景 | 结果 | 是否通过 | 证据或错误摘要 |
|---|---|---|---|
| `node --test opt-lab/tests/*.test.mjs cs2-sensitivity/tests/*.test.mjs cs2-lineups/tests/*.test.mjs` | 100 pass / 0 fail | 通过 | 含 9 条 lineups：空 hash、7 图可用性、hash 往返、非法回退、Mirage 中路分组、Dust II 目录隔离、v1→v2 迁移、开局父路由、缺失媒体不造假图 |
| `node scripts/check-web.mjs` | Web shell source checks passed | 通过 | 断言 nav-header / screenHost、canonical hash、`cs2-lineups-map.v2`、manifest 0.2.0、以及旧 `detailDialog` / `mapSelect` / `filterRow` / `<dialog` / `side-panel` / `searchInput` 已移除 |
| `git diff --check` | 无空白错误 | 通过 | 在含本交接文档的干净工作树上执行 |
| 五层核心路径（Chromium 1440×900，预览 `http://127.0.0.1:4173/modules/cs2-lineups/`） | L0 `#/maps` → L1 `#/side/mirage` → L2 `#/radar/mirage/T/nearby` → 中路点击 `#/nearby/mirage/T/575/484` → L4 `#/lineup/mirage/demo-t-connector-smoke` 默认瞄点图 | 通过 | 7 卡；Cache 不可进；附近按烟 1 / 闪 1 分组且无 `.side-panel` / `dialog`；详情显示「素材未提供」。截图：`nav_l0_map_select.png` … `nav_l4_detail.png` |
| 无效雷达点击 | 留在 `#/radar/mirage/T/nearby`，toast「请点击地图有效区域」 | 通过 | puppeteer 点雷达左上透明边界 |
| 键盘切图不新增历史 | 右键 result、左键 stance，hash 仍为同一 lineup | 通过 | ArrowRight / ArrowLeft |
| 浏览器返回顺序 | 详情 → 附近 → 雷达 → 阵营 → `#/maps` | 通过 | `page.goBack()` 四次 |
| 开局路线支线 | 5 个出生圆点；spawn → objective → plan；step/1 push；complete replace 到 step/2；再返回到 plan | 通过 | `#/radar/mirage/T/opening` 截图 `nav_l2_opening_spawns.png` |
| 非法深链 | `#/lineup/mirage/does-not-exist` 新页加载后落到 `#/radar/mirage/T/nearby` | 通过 | 新 page，不依赖 hashchange |
| Dust II | `#/radar/dust2/CT/nearby` | 通过 | 地图选择 → CT |
| 独立预览 | `/modules/cs2-lineups/` 空 hash 初始化为 `#/maps` | 通过 | 预览服务器 200 |
| OPT / LAB iframe | 壳层 `data-open-module="cs2-lineups"` 打开 iframe，冷启动 `#/maps` | 通过 | `nav_opt_lab_iframe.png`；壳层 favicon 404 已忽略 |
| file:// | `file:///workspace/cs2-lineups/index.html` 加载 7 卡、`#/maps`、无 pageerror | 通过 | Chromium automation，`nav_file_protocol.png`。不是 Safari/Edge 人工双击 |
| 360×800 / 844×390 / 1024×768 / 1440×900 | 无横向溢出、无工作台、可见按钮 ≥44px | 通过 | 雷达屏实测；360 截图 `nav_viewport_360x800.png` |
| Chromium console | lineups 模块无 pageerror；唯一 404 为 OPT / LAB favicon | 通过 | 过滤 favicon 后错误数组为空 |

本轮证据只证明导航栈、hash、入口和视口。演示瞄点、出生圆点和开局步骤仍是交互原型，**不能**当作实战投掷验证。

先前工作台式布局的浏览器记录不能当作本轮导航改版完成证据。

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
- 不得声称 Safari、Edge 或真实手机已通过。
- 不得把导航通过、浏览器通过或演示数据写成实战瞄点验证。

## 已知问题与风险

1. 当前交付是完整交互原型，不是可依赖的实战道具库。
2. 当前区域多边形、出生锚点和投掷物标点仍是交互演示，需要针对官方雷达逐项校准后才能成为正式内容。
3. 详情三帧现在明确显示“素材未提供”，不再生成假游戏截图。
4. 单文件嵌入 24–30 条三帧高清媒体会明显增加 HTML 体积；正式嵌入前应先压缩为 WebP，并报告最终文件大小。
5. file:// 下各浏览器的本机存储策略可能不同。本轮只证明 Chromium 能加载页面；Safari/Edge 仍需人工。
6. 地图、出生池或投掷行为变化后，正式内容必须转为 needs-review，不能继续进入默认推荐。
7. 应用只监听 `popstate`，不监听 `hashchange`。同页改 `location.hash` 不会重新启动；刷新或新文档加载才会解析深链。
8. Mirage 区域多边形有重叠：规范示例坐标 `512,386` 命中 `window` 而不是 `mid`。中路验收点使用 `575,485`（附近 hash 四舍五入为 `575/484`）。

## 接手步骤

1. 首先读取本交接文档，禁止只依赖聊天记录。
2. 运行第一条命令：git status --short --branch
3. 运行基线：node --test opt-lab/tests/*.test.mjs cs2-sensitivity/tests/*.test.mjs cs2-lineups/tests/*.test.mjs && node scripts/check-web.mjs
4. 打开的第一个文件：cs2-lineups/index.html
5. 优先处理任务：CONTENT-001（BLOCKED_EXTERNAL）。不要把 demo 改成已验证。
6. 导航函数以 `CS2LineupsCore` / `CS2LineupsApp` 为准；事件处理器不得直接改 hash 字段。
7. 每替换一批内容就运行内联脚本语法、禁止 API、现有测试、浏览器主流程和控制台检查。
8. 结束前更新本交接文档的时间、HEAD、工作区状态、验证结果和所有未完成任务。
