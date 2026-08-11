using System.Text.Json;
using OptLab.Core.Contracts;

namespace OptLab.App.Services;

public sealed class LocalCalibrationHistoryStore
{
    private const int MaximumItems = 20;
    private readonly string directory;
    private readonly string historyPath;
    private readonly JsonSerializerOptions serializerOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public LocalCalibrationHistoryStore(string directory)
    {
        this.directory = directory;
        historyPath = Path.Combine(directory, "calibration-history.json");
    }

    public async Task AppendAsync(CalibrationResult record, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(directory);
        var current = await ReadAsync(cancellationToken);
        var updated = new[] { record }
            .Concat(current.Where(item => item.CompletedAt != record.CompletedAt || item.Command != record.Command))
            .Take(MaximumItems)
            .ToArray();

        var temporaryPath = Path.Combine(directory, $".calibration-history.{Guid.NewGuid():N}.tmp");
        await using (var stream = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, useAsync: true))
        {
            await JsonSerializer.SerializeAsync(stream, updated, serializerOptions, cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }

        File.Move(temporaryPath, historyPath, overwrite: true);
    }

    private async Task<IReadOnlyList<CalibrationResult>> ReadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(historyPath))
        {
            return Array.Empty<CalibrationResult>();
        }

        await using var stream = File.OpenRead(historyPath);
        return await JsonSerializer.DeserializeAsync<CalibrationResult[]>(stream, serializerOptions, cancellationToken)
            ?? Array.Empty<CalibrationResult>();
    }
}

