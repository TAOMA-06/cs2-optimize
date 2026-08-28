using System.Text.Json;
using System.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using OptLab.App.Services;
using OptLab.Core.Contracts;
using OptLab.Core.Services;

namespace OptLab;

public sealed partial class MainWindow : Window
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly ModuleBridge moduleBridge = new(new LocalCalibrationHistoryStore(OptLabPaths.UserDataDirectory));
    private readonly HashSet<ulong> blockedNavigationIds = new();
    private bool isInitializing;
    private bool isWebViewConfigured;

    public MainWindow()
    {
        InitializeComponent();
    }

    private async void OnRootLoaded(object sender, RoutedEventArgs eventArgs)
    {
        RootGrid.Loaded -= OnRootLoaded;
        await InitializeShellAsync();
    }

    private async void OnRetryClick(object sender, RoutedEventArgs eventArgs)
    {
        await InitializeShellAsync();
    }

    private void OnCloseClick(object sender, RoutedEventArgs eventArgs)
    {
        Close();
    }

    private async Task InitializeShellAsync()
    {
        if (isInitializing)
        {
            return;
        }

        isInitializing = true;
        RetryButton.IsEnabled = false;
        FallbackProgress.IsActive = true;

        try
        {
            var assetRoot = Path.Combine(AppContext.BaseDirectory, "Assets");
            if (!Directory.Exists(assetRoot))
            {
                throw new DirectoryNotFoundException("The OPT / LAB packaged assets directory is missing.");
            }

            await ShellView.EnsureCoreWebView2Async();
            var webView = ShellView.CoreWebView2;
            if (!isWebViewConfigured)
            {
                webView.SetVirtualHostNameToFolderMapping(
                    "oplab.local",
                    assetRoot,
                    CoreWebView2HostResourceAccessKind.DenyCors);
                webView.Settings.AreDevToolsEnabled = IsDevelopmentBuild();
                webView.Settings.AreDefaultContextMenusEnabled = IsDevelopmentBuild();
                webView.Settings.IsStatusBarEnabled = false;
                webView.NavigationStarting += OnNavigationStarting;
                webView.FrameNavigationStarting += OnFrameNavigationStarting;
                webView.NavigationCompleted += OnNavigationCompleted;
                webView.AddWebResourceRequestedFilter(
                    "*",
                    CoreWebView2WebResourceContext.All,
                    CoreWebView2WebResourceRequestSourceKinds.All);
                webView.WebResourceRequested += OnWebResourceRequested;
                webView.WebMessageReceived += OnWebMessageReceived;
                isWebViewConfigured = true;
            }

            FallbackPanel.Visibility = Visibility.Collapsed;
            ShellView.Visibility = Visibility.Visible;
            webView.Navigate("https://oplab.local/index.html");
        }
        catch (Exception exception)
        {
            ShellView.Visibility = Visibility.Collapsed;
            FallbackText.Text = $"无法初始化 WebView2 或本地资源。{Environment.NewLine}{exception.Message}";
            FallbackPanel.Visibility = Visibility.Visible;
        }
        finally
        {
            FallbackProgress.IsActive = false;
            RetryButton.IsEnabled = true;
            isInitializing = false;
        }
    }

    private void OnNavigationCompleted(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
    {
        if (blockedNavigationIds.Remove(eventArgs.NavigationId))
        {
            return;
        }

        if (eventArgs.IsSuccess)
        {
            return;
        }

        ShellView.Visibility = Visibility.Collapsed;
        FallbackText.Text = $"本地工作台导航失败：{eventArgs.WebErrorStatus}。可重新初始化，不会清除本机记录。";
        FallbackPanel.Visibility = Visibility.Visible;
    }

    private void OnNavigationStarting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs eventArgs)
    {
        if (!IsTrustedLocalUri(eventArgs.Uri))
        {
            blockedNavigationIds.Add(eventArgs.NavigationId);
            eventArgs.Cancel = true;
        }
    }

    private void OnFrameNavigationStarting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs eventArgs)
    {
        if (!IsTrustedLocalUri(eventArgs.Uri))
        {
            eventArgs.Cancel = true;
        }
    }

    private void OnWebResourceRequested(CoreWebView2 sender, CoreWebView2WebResourceRequestedEventArgs eventArgs)
    {
        if (IsTrustedLocalUri(eventArgs.Request.Uri))
        {
            return;
        }

        var body = new MemoryStream(Encoding.UTF8.GetBytes("OPT / LAB blocks remote module resources."));
        eventArgs.Response = sender.Environment.CreateWebResourceResponse(
            body,
            403,
            "Blocked",
            "Content-Type: text/plain; charset=utf-8");
    }

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        HostMessage? message = null;
        try
        {
            message = JsonSerializer.Deserialize<HostMessage>(eventArgs.WebMessageAsJson, JsonOptions);
            if (message is null || message.ProtocolVersion != 1)
            {
                return;
            }

            if (!await TryHandleExternalNavigationAsync(message))
            {
                await moduleBridge.ReceiveAsync(message);
            }

            PostHostMessage(sender, "host.acknowledged", message.RequestId, new
            {
                requestType = message.Type,
                accepted = true
            });

            if (string.Equals(message.Type, "shell.ready", StringComparison.Ordinal))
            {
                PostHostMessage(sender, "host.context", message.RequestId, HostContextProvider.Create());
            }
        }
        catch (JsonException)
        {
            // Malformed browser messages are ignored; browser content never controls native execution.
        }
        catch (InvalidOperationException)
        {
            if (message is not null)
            {
                TryPostHostError(sender, message.RequestId, "request-rejected", "桌面宿主拒绝了未发布或无效的请求。");
            }
        }
        catch (Exception)
        {
            if (message is not null)
            {
                TryPostHostError(sender, message.RequestId, "host-failure", "桌面宿主未能完成这次本机请求。");
            }
        }
    }

    private static void PostHostMessage(CoreWebView2 sender, string type, string requestId, object payload)
    {
        sender.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            protocolVersion = 1,
            type,
            requestId,
            moduleId = "host",
            payload
        }, JsonOptions));
    }

    private static void TryPostHostError(CoreWebView2 sender, string requestId, string code, string message)
    {
        try
        {
            PostHostMessage(sender, "host.error", requestId, new { code, message });
        }
        catch (InvalidOperationException)
        {
            // The WebView may be shutting down; no further UI notification is possible.
        }
    }

    private static bool IsDevelopmentBuild()
    {
#if DEBUG
        return true;
#else
        return false;
#endif
    }

    private static async Task<bool> TryHandleExternalNavigationAsync(HostMessage message)
    {
        Uri target;
        switch (message.Type)
        {
            case "system.open-settings":
                var pageId = ReadPayloadString(message.Payload, "pageId");
                if (!ExternalNavigationCatalog.TryGetSettingsUri(pageId, out target))
                {
                    throw new InvalidOperationException("The requested Windows settings page is not published by OPT / LAB.");
                }
                break;
            case "source.open":
                var sourceId = ReadPayloadString(message.Payload, "sourceId");
                if (!ExternalNavigationCatalog.TryGetSourceUri(sourceId, out target))
                {
                    throw new InvalidOperationException("The requested research source is not published by OPT / LAB.");
                }
                break;
            default:
                return false;
        }

        try
        {
            if (!await Windows.System.Launcher.LaunchUriAsync(target))
            {
                throw new InvalidOperationException("Windows could not open the requested destination.");
            }
        }
        catch (Exception exception) when (exception is not InvalidOperationException)
        {
            throw new InvalidOperationException("Windows could not open the requested destination.", exception);
        }

        return true;
    }

    private static string ReadPayloadString(JsonElement payload, string propertyName)
    {
        if (payload.ValueKind != JsonValueKind.Object ||
            !payload.TryGetProperty(propertyName, out var value) ||
            value.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(value.GetString()))
        {
            throw new InvalidOperationException($"Browser message is missing {propertyName}.");
        }

        return value.GetString()!;
    }

    private static bool IsTrustedLocalUri(string candidate) =>
        Uri.TryCreate(candidate, UriKind.Absolute, out var target) &&
        string.Equals(target.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(target.Host, "oplab.local", StringComparison.OrdinalIgnoreCase);
}
