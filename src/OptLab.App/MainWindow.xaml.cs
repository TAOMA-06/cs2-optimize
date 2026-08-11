using System.Text.Json;
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

    public MainWindow()
    {
        InitializeComponent();
    }

    private async void OnRootLoaded(object sender, RoutedEventArgs eventArgs)
    {
        RootGrid.Loaded -= OnRootLoaded;

        try
        {
            var assetRoot = Path.Combine(AppContext.BaseDirectory, "Assets");
            if (!Directory.Exists(assetRoot))
            {
                throw new DirectoryNotFoundException("The OPT / LAB packaged assets directory is missing.");
            }

            await ShellView.EnsureCoreWebView2Async();
            var webView = ShellView.CoreWebView2;
            webView.SetVirtualHostNameToFolderMapping(
                "oplab.local",
                assetRoot,
                CoreWebView2HostResourceAccessKind.DenyCors);
            webView.Settings.AreDevToolsEnabled = IsDevelopmentBuild();
            webView.Settings.AreDefaultContextMenusEnabled = IsDevelopmentBuild();
            webView.Settings.IsStatusBarEnabled = false;
            webView.NavigationStarting += OnNavigationStarting;
            webView.WebMessageReceived += OnWebMessageReceived;
            ShellView.Source = new Uri("https://oplab.local/Shell/index.html");
        }
        catch (Exception exception)
        {
            ShellView.Visibility = Visibility.Collapsed;
            FallbackText.Text = $"无法初始化 WebView2 或本地资源。{Environment.NewLine}{exception.Message}";
            FallbackPanel.Visibility = Visibility.Visible;
        }
    }

    private void OnNavigationStarting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs eventArgs)
    {
        if (!Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var target) ||
            !string.Equals(target.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(target.Host, "oplab.local", StringComparison.OrdinalIgnoreCase))
        {
            eventArgs.Cancel = true;
        }
    }

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        try
        {
            var message = JsonSerializer.Deserialize<HostMessage>(eventArgs.WebMessageAsJson, JsonOptions);
            if (message is null || message.ProtocolVersion != 1)
            {
                return;
            }

            await moduleBridge.ReceiveAsync(message);
            sender.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                protocolVersion = 1,
                type = "host.acknowledged",
                requestId = message.RequestId
            }, JsonOptions));
        }
        catch (JsonException)
        {
            // Malformed browser messages are ignored; browser content never controls native execution.
        }
        catch (InvalidOperationException)
        {
            // Messages with an unsupported module/type are deliberately ignored.
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
}
