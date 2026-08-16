export const RESEARCH_CUTOFF = "2026-08-15";

export const SOURCES = Object.freeze({
  "microsoft-refresh-rate": Object.freeze({
    title: "Microsoft：更改显示器刷新率",
    publisher: "Microsoft Support",
    url: "https://support.microsoft.com/en-us/windows/hardware/display-graphics/change-the-refresh-rate-on-your-monitor-in-windows"
  }),
  "microsoft-game-mode": Object.freeze({
    title: "Microsoft：Windows 游戏设置与 Game Mode",
    publisher: "Microsoft Support",
    url: "https://support.microsoft.com/en-us/accessibility/windows/understand-and-explore-windows-settings"
  }),
  "microsoft-windowed-games": Object.freeze({
    title: "Microsoft：Windows 11 窗口化游戏优化",
    publisher: "Microsoft Support",
    url: "https://support.microsoft.com/en-us/windows/hardware/display-graphics/optimizations-for-windowed-games-in-windows-11"
  }),
  "microsoft-power-mode": Object.freeze({
    title: "Microsoft：更改 Windows 电源模式",
    publisher: "Microsoft Support",
    url: "https://support.microsoft.com/en-au/windows/change-the-power-mode-for-your-windows-pc-c2aff038-22c9-f46d-5ca0-78696fdf2de8"
  }),
  "microsoft-settings-uri": Object.freeze({
    title: "Microsoft：Windows 设置 URI",
    publisher: "Microsoft Learn",
    url: "https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings"
  }),
  "microsoft-windows10-eos": Object.freeze({
    title: "Microsoft：Windows 10 已于 2025-10-14 结束支持",
    publisher: "Microsoft Support",
    url: "https://support.microsoft.com/en-us/windows/deployment/updates-lifecycle/what-does-it-mean-if-windows-isn-t-supported"
  }),
  "nvidia-reflex": Object.freeze({
    title: "NVIDIA：在 Counter-Strike 2 中启用 Reflex",
    publisher: "NVIDIA",
    url: "https://www.nvidia.cn/geforce/news/counter-strike-2-released-featuring-nvidia-reflex/"
  }),
  "amd-antilag2": Object.freeze({
    title: "AMD：Counter-Strike 2 的 Radeon Anti-Lag 2",
    publisher: "AMD",
    url: "https://www.amd.com/en/products/software/adrenalin/radeon-software-anti-lag.html"
  }),
  "valve-network-telemetry": Object.freeze({
    title: "Valve：CS2 网络质量与遥测更新",
    publisher: "Valve / Steam",
    url: "https://store.steampowered.com/news/posts/?appids=730&enddate=1734194563&feed=steam_announce%2F1000"
  }),
  "steam-verify-files": Object.freeze({
    title: "Steam：验证游戏文件完整性",
    publisher: "Steam Support",
    url: "https://help.steampowered.com/en/faqs/view/0C48-FCBD-DA71-93EB"
  }),
  "perfectworld-assistant": Object.freeze({
    title: "完美平台：官方助手与一键优化",
    publisher: "完美世界竞技平台",
    url: "https://www.csgo.com.cn/article/details/20210312/225044.html"
  }),
  "perfectworld-cs2-return": Object.freeze({
    title: "完美平台：CS2 适配与一键优化回归",
    publisher: "完美世界竞技平台",
    url: "https://www.csgo.com.cn/article/details/20240112/225674.html"
  }),
  "fivee-stutter-guide": Object.freeze({
    title: "5E：CS2 更新后卡顿优化指南",
    publisher: "5EPlay",
    url: "https://csgo.5eplay.com/article/260130zenfrq"
  })
});

const common = [
  {
    id: "windows10-support-boundary",
    group: "windows",
    level: "essential",
    quick: true,
    windows10Only: true,
    title: "先确认 Windows 10 的支持边界",
    summary: "Windows 10 仍能运行，但常规免费安全更新和技术支持已在 2025 年 10 月结束。",
    why: "Microsoft 建议迁移到仍受支持的 Windows 版本。性能优化不能替代操作系统安全修复。",
    steps: ["打开 Windows 更新", "确认设备的实际版本与更新状态", "规划迁移到受支持的 Windows 11"],
    verify: "记录当前版本与是否存在组织版或扩展安全更新；不能把普通 Windows 10 设备标成完整发布验证环境。",
    action: { type: "settings", pageId: "windows-update", label: "打开 Windows 更新", fallback: "设置 → 更新和安全 → Windows 更新" },
    sources: ["microsoft-windows10-eos", "microsoft-settings-uri"]
  },
  {
    id: "display-refresh-rate",
    group: "windows",
    level: "essential",
    quick: true,
    title: "确认 Windows 正在使用高刷新率",
    summary: "高刷显示器接在电脑上，不代表 Windows 已经选中了它支持的最高刷新率。",
    why: "Microsoft 明确说明更高刷新率可减少运动模糊、撕裂和输入延迟；最终可选值仍取决于显示器、接口与当前分辨率。",
    steps: ["打开高级显示", "选择实际玩 CS2 的显示器", "确认刷新率与显示器能力相符"],
    verify: "回到高级显示页，记录当前分辨率与 Hz。不要为了更高 Hz 意外切换到错误分辨率。",
    action: { type: "settings", pageId: "advanced-display", label: "打开高级显示", fallback: "设置 → 系统 → 显示 → 高级显示" },
    sources: ["microsoft-refresh-rate", "microsoft-settings-uri"]
  },
  {
    id: "windows-game-mode",
    group: "windows",
    level: "essential",
    quick: true,
    title: "开启 Game Mode",
    summary: "使用 Windows 自带的游戏调度入口，避免用来路不明的服务停用脚本代替它。",
    why: "Microsoft 将 Game Mode 作为 Windows 的游戏性能设置；它比批量停服务、改调度注册表更可解释，也更容易恢复。",
    steps: ["打开游戏模式", "将 Game Mode 设为开", "重新启动 CS2 后验证帧时间"],
    verify: "设置页显示为开。它不会保证固定 FPS，仍需用同一场景比较帧时间。",
    action: { type: "settings", pageId: "game-mode", label: "打开游戏模式", fallback: "设置 → 游戏 → 游戏模式" },
    sources: ["microsoft-game-mode", "microsoft-settings-uri"]
  },
  {
    id: "session-background-load",
    group: "session",
    level: "essential",
    quick: true,
    title: "开赛前只关闭你认识的重负载程序",
    summary: "先处理浏览器视频、下载、录制与直播程序；不批量结束服务，也不碰反作弊进程。",
    why: "这是 5E 当前卡顿指南中的直接建议，也能避免把普通资源争用误判成系统参数问题。",
    steps: ["保存正在进行的工作", "关闭不需要的浏览器视频、下载或录制", "保留 Steam、游戏平台、声卡和反作弊组件"],
    verify: "任务管理器里没有你主动开启的高 CPU、GPU 或磁盘后台任务。",
    action: { type: "settings", pageId: "startup-apps", label: "查看启动应用", fallback: "设置 → 应用 → 启动" },
    sources: ["fivee-stutter-guide", "microsoft-settings-uri"]
  },
  {
    id: "high-performance-gpu",
    group: "windows",
    level: "recommended",
    quick: false,
    title: "多显卡设备为 CS2 选择高性能 GPU",
    summary: "适用于同时有核显与独显的笔记本或台式机；单 GPU 设备通常无需处理。",
    why: "Windows 图形首选项允许为单个游戏选择高性能 GPU，避免应用落到节能 GPU。",
    steps: ["打开图形设置", "添加或找到 cs2.exe", "仅在多 GPU 设备上选择高性能"],
    verify: "Windows 图形设置中的 CS2 条目显示为高性能；重启游戏后生效。",
    action: { type: "settings", pageId: "graphics", label: "打开图形设置", fallback: "设置 → 系统 → 显示 → 图形" },
    sources: ["microsoft-windowed-games", "microsoft-settings-uri"]
  },
  {
    id: "performance-power-mode",
    group: "windows",
    level: "recommended",
    quick: false,
    title: "插电比赛时使用最佳性能电源模式",
    summary: "性能模式会提高功耗、温度和风扇噪音；笔记本请只在插电并散热正常时使用。",
    why: "Microsoft 将“最佳性能”定义为最大化性能，并明确提示它会增加耗电和发热。",
    steps: ["先接通电源", "打开电源设置", "比赛期间选择最佳性能"],
    verify: "记录修改前的模式，比赛结束后可恢复平衡模式。若温度导致降频，性能模式可能适得其反。",
    action: { type: "settings", pageId: "power", label: "打开电源设置", fallback: "设置 → 系统 → 电源和电池" },
    sources: ["microsoft-power-mode", "microsoft-settings-uri"]
  },
  {
    id: "windowed-game-optimization",
    group: "windows",
    level: "recommended",
    quick: false,
    windows11Only: true,
    title: "Windows 11 无边框模式检查窗口化游戏优化",
    summary: "只在 Windows 11、DX10/11 且使用窗口/无边框时相关；独占全屏或 Vulkan 不按这条处理。",
    why: "Microsoft 表示该功能会将兼容游戏转为 flip model，从而降低帧延迟并支持 VRR 等能力。",
    steps: ["确认你使用无边框或窗口模式", "打开默认图形设置", "检查窗口化游戏优化"],
    verify: "重启 CS2，用相同地图与设置比较帧时间；如果出现异常，可按应用关闭。",
    action: { type: "settings", pageId: "graphics-default", label: "打开默认图形设置", fallback: "设置 → 系统 → 显示 → 图形 → 默认图形设置" },
    sources: ["microsoft-windowed-games", "microsoft-settings-uri"]
  },
  {
    id: "cs2-network-telemetry",
    group: "cs2",
    level: "recommended",
    quick: false,
    title: "打开 CS2 网络质量详细显示",
    summary: "先确认是 FPS、帧时间还是网络抖动，再决定下一步；不自动改 DNS、MTU 或 TCP 注册表。",
    why: "Valve 已把网络质量指标改为反映真正影响游戏的丢包与抖动，并提供原始丢包/抖动详细显示。",
    steps: ["进入 CS2 设置中的遥测选项", "开启详细网络质量显示", "在真实对局记录丢包与抖动"],
    verify: "卡顿出现时同步查看 FPS 与网络指标；网络异常不等同于本机性能不足。",
    action: { type: "instruction", label: "复制游戏内路径", fallback: "CS2 → 设置 → 游戏 → 遥测 → 显示网络质量详细信息" },
    sources: ["valve-network-telemetry"]
  },
  {
    id: "steam-verify-files",
    group: "repair",
    level: "troubleshoot",
    quick: false,
    title: "只在崩溃或资源缺失时验证游戏文件",
    summary: "文件校验是故障修复，不是每次开赛前都要做的性能优化。",
    why: "Steam 官方将它用于缺失纹理、内容或崩溃，并提醒校验时不要同时运行其他高负载任务。",
    steps: ["重启电脑并打开 Steam", "CS2 属性 → 已安装文件", "选择验证游戏文件完整性"],
    verify: "校验完成后再启动游戏；少数本地配置文件未通过可能是正常现象。",
    action: { type: "instruction", label: "复制修复路径", fallback: "Steam → 库 → CS2 → 属性 → 已安装文件 → 验证游戏文件完整性" },
    sources: ["steam-verify-files"]
  }
];

const vendorSpecific = {
  nvidia: {
    id: "nvidia-reflex",
    group: "gpu",
    level: "essential",
    quick: true,
    title: "在 CS2 内启用 NVIDIA Reflex",
    summary: "优先使用游戏内集成的 Reflex；不要同时叠加来路不明的低延迟注册表脚本。",
    why: "NVIDIA 与 Valve 合作集成 Reflex。官方建议在高级视频中启用；“启用 + Boost”只适合更重视最低延迟且接受额外功耗与可能稍低帧率的人。",
    steps: ["CS2 → 设置 → 视频 → 高级视频", "NVIDIA Reflex 低延迟设为启用", "先不要使用启用 + Boost"],
    verify: "用同一场景观察 PC 延迟与帧时间；只有在温度、功耗允许时再单独比较 Boost。",
    action: { type: "instruction", label: "复制游戏内路径", fallback: "CS2 → 设置 → 视频 → 高级视频 → NVIDIA Reflex 低延迟：启用" },
    sources: ["nvidia-reflex"]
  },
  amd: {
    id: "amd-antilag2",
    group: "gpu",
    level: "essential",
    quick: true,
    title: "使用游戏内集成的 AMD Anti-Lag 2",
    summary: "更新到支持的 AMD 驱动后，在 CS2 高级视频内确认 Anti-Lag 2；不要用旧式注入方案代替。",
    why: "AMD 说明 Anti-Lag 2 是与 Valve 集成的游戏内能力，支持 RDNA 架构及以上产品，并列出 CS2 为当前支持游戏。",
    steps: ["安装 AMD 官方当前稳定驱动", "CS2 → 设置 → 视频 → 高级视频", "确认 AMD Anti-Lag 2 已启用"],
    verify: "Anti-Lag 2 需要受支持的 AMD GPU 与驱动；Vulkan 模式的支持边界应以当前驱动说明为准。",
    action: { type: "instruction", label: "复制游戏内路径", fallback: "CS2 → 设置 → 视频 → 高级视频 → AMD Anti-Lag 2：启用" },
    sources: ["amd-antilag2"]
  },
  unknown: {
    id: "choose-gpu-vendor",
    group: "gpu",
    level: "essential",
    quick: true,
    title: "先选择显卡品牌，再给低延迟建议",
    summary: "NVIDIA Reflex 与 AMD Anti-Lag 2 的适用条件不同；未识别硬件时不猜。",
    why: "选择上方显卡品牌后，本项会替换为对应的游戏内设置，并显示它的兼容性与取舍。",
    steps: ["在上方选择 NVIDIA、AMD 或其他", "按新的建议进入 CS2 高级视频", "用相同场景验证"],
    verify: "设备管理器或显卡控制面板中的名称与选择一致。",
    action: { type: "none", label: "等待选择", fallback: "请先选择显卡品牌" },
    sources: []
  },
  other: {
    id: "other-gpu-baseline",
    group: "gpu",
    level: "recommended",
    quick: true,
    title: "使用显卡厂商稳定驱动与 CS2 内置选项",
    summary: "当前证据库没有适用于该显卡的专用低延迟开关，因此不伪造通用替代项。",
    why: "不同驱动的低延迟机制不可互换。保持官方稳定驱动，并以游戏内实际可见选项为准。",
    steps: ["确认显卡型号", "通过厂商官方渠道检查稳定驱动", "不要导入第三方控制面板配置"],
    verify: "驱动来源可追溯，CS2 能正常启动且帧时间稳定。",
    action: { type: "instruction", label: "复制检查原则", fallback: "使用显卡厂商官方稳定驱动；只调整 CS2 内实际存在的选项" },
    sources: []
  }
};

const platformSpecific = {
  perfect: {
    id: "perfectworld-assistant",
    group: "platform",
    level: "recommended",
    quick: true,
    title: "优先复用完美平台自己的优化助手",
    summary: "完美平台公开过视频、显卡、深度游戏设置与启动项优化；本应用不复制其未公开的内部参数。",
    why: "完美官方 2021 年公布了优化助手能力，2024 年又确认 CS2 适配后“一键优化”回归。具体规则会随平台和游戏版本更新。",
    steps: ["更新完美世界竞技平台", "进入平台内的一键优化/官方助手", "查看变更项后再应用，并保留平台内恢复入口"],
    verify: "确认平台版本、优化前后视频设置与启动项；出现问题优先在平台内恢复默认。",
    action: { type: "instruction", label: "复制平台路径", fallback: "完美世界竞技平台 → CS2 → 官方助手 / 一键优化 → 逐项检查后应用" },
    sources: ["perfectworld-assistant", "perfectworld-cs2-return"]
  },
  fivee: {
    id: "fivee-default-launch-options",
    group: "platform",
    level: "recommended",
    quick: true,
    title: "5EBOX 使用当前默认启动参数",
    summary: "先恢复 5E 当前默认参数，不叠加旧教程里的 -tickrate、-freq、-threads 等组合。",
    why: "5E 2026 年卡顿指南建议在 5EBOX 使用默认参数，并明确不建议继续添加部分旧启动项。",
    steps: ["5E 对战平台 → 5EBOX", "启动项设置 → 使用默认参数", "删除自己无法解释的旧参数"],
    verify: "只保留平台当前默认与自己明确需要的参数；修改后重启平台和游戏。",
    action: { type: "instruction", label: "复制平台路径", fallback: "5E 对战平台 → 5EBOX → 启动项设置 → 使用默认参数" },
    sources: ["fivee-stutter-guide"]
  },
  steam: {
    id: "steam-clean-baseline",
    group: "platform",
    level: "recommended",
    quick: true,
    title: "Steam 启动项保持最小基线",
    summary: "没有明确用途的历史启动参数先移除；游戏更新后优先使用当前游戏内设置。",
    why: "启动项会跨版本持续生效，而 CS2 本身持续更新。当前证据不足以支持一组对所有硬件都有效的“万能参数”。",
    steps: ["打开 CS2 属性", "记录现有启动项", "移除无法说明用途与来源的旧参数"],
    verify: "CS2 正常启动；需要国服入口时只保留完美官方说明的 -perfectworld。",
    action: { type: "instruction", label: "复制检查路径", fallback: "Steam → 库 → CS2 → 属性 → 通用 → 启动选项" },
    sources: ["perfectworld-assistant"]
  }
};

export const REJECTED_TWEAKS = Object.freeze([
  "不提供 HPET、useplatformclock、disabledynamictick 或其他 bcdedit 计时器脚本。",
  "不批量停用 Windows 服务、Defender、内存完整性、虚拟化或游戏平台反作弊组件。",
  "不写入所谓网络加速注册表、固定 DNS、MTU、Nagle 或 TCP 全局模板。",
  "不默认加入 -threads、-tickrate 128、-freq、-nojoy、-high 等旧启动项组合。",
  "不导入陌生职业选手 CFG 覆盖个人键位、音频、准星或视频设置。",
  "不结束完美、5E、Steam、声卡、外设驱动或反作弊进程来换取表面上的后台数量下降。"
]);

export function getRecommendations(profile, mode = "quick") {
  const normalized = normalizeProfile(profile);
  const rules = [
    ...common,
    vendorSpecific[normalized.gpuVendor],
    platformSpecific[normalized.platform]
  ].filter(Boolean);

  return rules.filter((rule) => {
    if (mode === "quick" && !rule.quick) return false;
    if (rule.windows11Only && normalized.os !== "windows11") return false;
    if (rule.windows10Only && normalized.os !== "windows10") return false;
    return true;
  });
}

export function normalizeProfile(profile) {
  return {
    os: ["windows11", "windows10"].includes(profile?.os) ? profile.os : "windows11",
    gpuVendor: ["nvidia", "amd", "other", "unknown"].includes(profile?.gpuVendor) ? profile.gpuVendor : "unknown",
    platform: ["perfect", "fivee", "steam"].includes(profile?.platform) ? profile.platform : "perfect",
    planMode: ["quick", "full"].includes(profile?.planMode) ? profile.planMode : "quick"
  };
}

export function getSource(sourceId) {
  return SOURCES[sourceId] ?? null;
}
