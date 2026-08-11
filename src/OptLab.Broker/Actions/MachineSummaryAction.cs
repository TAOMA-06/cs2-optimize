using System.Runtime.InteropServices;
using System.Text.Json;

namespace OptLab.Broker.Actions;

public sealed class MachineSummaryAction : IRestrictedAction
{
    public string Id => "oplab.diagnostics.machine-summary";

    public bool IsSystemMutation => false;

    public Task<JsonElement> ExecuteAsync(JsonElement arguments, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var result = JsonSerializer.SerializeToElement(new
        {
            operatingSystem = RuntimeInformation.OSDescription,
            architecture = RuntimeInformation.OSArchitecture.ToString(),
            processArchitecture = RuntimeInformation.ProcessArchitecture.ToString(),
            framework = RuntimeInformation.FrameworkDescription,
            observedAt = DateTimeOffset.UtcNow
        });
        return Task.FromResult(result);
    }
}

