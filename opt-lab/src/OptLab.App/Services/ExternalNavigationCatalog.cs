namespace OptLab.App.Services;

internal static class ExternalNavigationCatalog
{
    private static readonly IReadOnlyDictionary<string, string> SettingsPages =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["advanced-display"] = "ms-settings:display-advanced",
            ["game-mode"] = "ms-settings:gaming-gamemode",
            ["graphics"] = "ms-settings:display-advancedgraphics",
            ["graphics-default"] = "ms-settings:display-advancedgraphics-default",
            ["power"] = "ms-settings:powersleep",
            ["startup-apps"] = "ms-settings:startupapps",
            ["windows-update"] = "ms-settings:windowsupdate"
        };

    private static readonly IReadOnlyDictionary<string, string> SourcePages =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["microsoft-refresh-rate"] = "https://support.microsoft.com/en-us/windows/hardware/display-graphics/change-the-refresh-rate-on-your-monitor-in-windows",
            ["microsoft-game-mode"] = "https://support.microsoft.com/en-us/accessibility/windows/understand-and-explore-windows-settings",
            ["microsoft-windowed-games"] = "https://support.microsoft.com/en-us/windows/hardware/display-graphics/optimizations-for-windowed-games-in-windows-11",
            ["microsoft-power-mode"] = "https://support.microsoft.com/en-au/windows/change-the-power-mode-for-your-windows-pc-c2aff038-22c9-f46d-5ca0-78696fdf2de8",
            ["microsoft-settings-uri"] = "https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings",
            ["microsoft-windows10-eos"] = "https://support.microsoft.com/en-us/windows/deployment/updates-lifecycle/what-does-it-mean-if-windows-isn-t-supported",
            ["nvidia-reflex"] = "https://www.nvidia.cn/geforce/news/counter-strike-2-released-featuring-nvidia-reflex/",
            ["amd-antilag2"] = "https://www.amd.com/en/products/software/adrenalin/radeon-software-anti-lag.html",
            ["valve-network-telemetry"] = "https://store.steampowered.com/news/posts/?appids=730&enddate=1734194563&feed=steam_announce%2F1000",
            ["steam-verify-files"] = "https://help.steampowered.com/en/faqs/view/0C48-FCBD-DA71-93EB",
            ["perfectworld-assistant"] = "https://www.csgo.com.cn/article/details/20210312/225044.html",
            ["perfectworld-cs2-return"] = "https://www.csgo.com.cn/article/details/20240112/225674.html",
            ["fivee-stutter-guide"] = "https://csgo.5eplay.com/article/260130zenfrq"
        };

    public static bool TryGetSettingsUri(string pageId, out Uri uri) =>
        TryResolve(SettingsPages, pageId, "ms-settings", out uri);

    public static bool TryGetSourceUri(string sourceId, out Uri uri) =>
        TryResolve(SourcePages, sourceId, Uri.UriSchemeHttps, out uri);

    private static bool TryResolve(
        IReadOnlyDictionary<string, string> catalog,
        string id,
        string requiredScheme,
        out Uri uri)
    {
        if (!catalog.TryGetValue(id, out var candidate) ||
            !Uri.TryCreate(candidate, UriKind.Absolute, out var resolved) ||
            !string.Equals(resolved.Scheme, requiredScheme, StringComparison.OrdinalIgnoreCase))
        {
            uri = null!;
            return false;
        }

        uri = resolved;
        return true;
    }
}
