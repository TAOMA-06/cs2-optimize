using System.Text.Json;
using OptLab.Core.Contracts;

namespace OptLab.Core.Services;

public sealed class TransactionJournal
{
    private readonly string journalDirectory;
    private readonly JsonSerializerOptions serializerOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public TransactionJournal(string journalDirectory)
    {
        this.journalDirectory = journalDirectory;
    }

    public async Task SaveAsync(TransactionRecord transaction, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(journalDirectory);
        var destination = GetPath(transaction.TransactionId);
        var temporary = Path.Combine(journalDirectory, $".{transaction.TransactionId:N}.{Guid.NewGuid():N}.tmp");

        await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, useAsync: true))
        {
            await JsonSerializer.SerializeAsync(stream, transaction, serializerOptions, cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }

        File.Move(temporary, destination, overwrite: true);
    }

    public async Task<TransactionRecord?> ReadAsync(Guid transactionId, CancellationToken cancellationToken = default)
    {
        var path = GetPath(transactionId);
        if (!File.Exists(path))
        {
            return null;
        }

        await using var stream = File.OpenRead(path);
        return await JsonSerializer.DeserializeAsync<TransactionRecord>(stream, serializerOptions, cancellationToken);
    }

    public async Task<IReadOnlyList<TransactionRecord>> ReadActiveAsync(CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(journalDirectory))
        {
            return Array.Empty<TransactionRecord>();
        }

        var active = new List<TransactionRecord>();
        foreach (var path in Directory.EnumerateFiles(journalDirectory, "*.json", SearchOption.TopDirectoryOnly))
        {
            await using var stream = File.OpenRead(path);
            var record = await JsonSerializer.DeserializeAsync<TransactionRecord>(stream, serializerOptions, cancellationToken);
            if (record is { Status: TransactionStatus.Snapshotted or TransactionStatus.Applying or TransactionStatus.Verified or TransactionStatus.RestoreRequired })
            {
                active.Add(record);
            }
        }

        return active.OrderByDescending(static record => record.UpdatedAt).ToArray();
    }

    private string GetPath(Guid transactionId) => Path.Combine(journalDirectory, $"{transactionId:N}.json");
}

