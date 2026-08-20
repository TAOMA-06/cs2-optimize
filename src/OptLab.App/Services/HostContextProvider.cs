using System.Runtime.InteropServices;

namespace OptLab.App.Services;

internal sealed record HostCapabilities(
    bool NativeShell,
    bool OpenSettings,
    bool OpenSources,
    bool CalibrationArchive,
    bool BrokerDiagnostics,
    bool SignedUpdates,
    bool SystemMutations);

internal sealed record HostContextSnapshot(
    string Mode,
    bool Connected,
    string HostVersion,
    string Platform,
    string OperatingSystem,
    string Architecture,
    string Runtime,
    string DataBoundary,
    HostCapabilities Capabilities);

internal static class HostContextProvider
{
    public static HostContextSnapshot Create()
    {
        var version = typeof(HostContextProvider).Assembly.GetName().Version;
        return new HostContextSnapshot(
            Mode: "desktop",
            Connected: true,
            HostVersion: version is null ? "1.0.0" : version.ToString(3),
            Platform: "Windows",
            OperatingSystem: RuntimeInformation.OSDescription.Trim(),
            Architecture: RuntimeInformation.OSArchitecture.ToString(),
            Runtime: "WinUI 3 / WebView2",
            DataBoundary: "local-only",
            Capabilities: new HostCapabilities(
                NativeShell: true,
                OpenSettings: true,
                OpenSources: true,
                CalibrationArchive: true,
                BrokerDiagnostics: false,
                SignedUpdates: false,
                SystemMutations: false));
    }
}
