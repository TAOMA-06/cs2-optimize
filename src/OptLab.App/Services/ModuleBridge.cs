using System.Text.Json;
using OptLab.Core.Contracts;

namespace OptLab.App.Services;

public sealed class ModuleBridge
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly LocalCalibrationHistoryStore calibrationHistoryStore;

    public ModuleBridge(LocalCalibrationHistoryStore calibrationHistoryStore)
    {
        this.calibrationHistoryStore = calibrationHistoryStore;
    }

    public async Task ReceiveAsync(HostMessage message, CancellationToken cancellationToken = default)
    {
        switch (message.Type)
        {
            case "shell.ready":
            case "module.opened":
            case "settings.updated":
            case "updates.check":
                return;
            case "module.result" when string.Equals(message.ModuleId, "cs2-sensitivity", StringComparison.Ordinal):
                var result = message.Payload.Deserialize<CalibrationResult>(JsonOptions)
                    ?? throw new InvalidOperationException("CS2 calibration result was empty.");
                ValidateCalibrationResult(result);
                await calibrationHistoryStore.AppendAsync(result, cancellationToken);
                return;
            default:
                throw new InvalidOperationException($"Unsupported browser message: {message.Type}.");
        }
    }

    private static void ValidateCalibrationResult(CalibrationResult result)
    {
        if (!string.Equals(result.ModuleId, "cs2-sensitivity", StringComparison.Ordinal) ||
            result.Sensitivity is < 0.1m or > 8m ||
            !result.Command.StartsWith("sensitivity ", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("CS2 calibration result did not satisfy the host contract.");
        }
    }
}
