using System.Text.Json;

namespace OptLab.Broker.Actions;

public interface IRestrictedAction
{
    string Id { get; }

    bool IsSystemMutation { get; }

    Task<JsonElement> ExecuteAsync(JsonElement arguments, CancellationToken cancellationToken);
}

