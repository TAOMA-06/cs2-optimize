using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace OptLab.Broker;

public sealed class NamedPipeBrokerWorker : BackgroundService
{
    public const string PipeName = "OptLab.Broker.Local.v1";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly ILogger<NamedPipeBrokerWorker> logger;
    private readonly AllowedActionRegistry actionRegistry;

    public NamedPipeBrokerWorker(
        ILogger<NamedPipeBrokerWorker> logger,
        AllowedActionRegistry actionRegistry)
    {
        this.logger = logger;
        this.actionRegistry = actionRegistry;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("OPT / LAB Broker is listening for restricted local requests.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(stoppingToken);
                await ServeConnectionAsync(pipe, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "OPT / LAB Broker connection failed.");
            }
        }
    }

    private async Task ServeConnectionAsync(Stream stream, CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true);
        await using var writer = new StreamWriter(stream, Encoding.UTF8, bufferSize: 4096, leaveOpen: true)
        {
            AutoFlush = true
        };

        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(cancellationToken);
            if (line is null)
            {
                return;
            }

            BrokerResponse response;
            try
            {
                var request = JsonSerializer.Deserialize<BrokerRequest>(line, JsonOptions)
                    ?? throw new JsonException("Broker request was empty.");
                response = await actionRegistry.ExecuteAsync(request, cancellationToken);
            }
            catch (JsonException)
            {
                response = new BrokerResponse(1, "unknown", false, "rejected", "Malformed broker request.", null);
            }

            await writer.WriteLineAsync(JsonSerializer.Serialize(response, JsonOptions));
        }
    }
}
