using System.Text.Json;
using OptLab.Broker.Actions;

namespace OptLab.Broker;

public sealed class AllowedActionRegistry
{
    private readonly IReadOnlyDictionary<string, IRestrictedAction> actions;

    public AllowedActionRegistry(IEnumerable<IRestrictedAction> registeredActions)
    {
        actions = registeredActions.ToDictionary(action => action.Id, StringComparer.Ordinal);
    }

    public async Task<BrokerResponse> ExecuteAsync(BrokerRequest request, CancellationToken cancellationToken)
    {
        if (request.ProtocolVersion != 1 || string.IsNullOrWhiteSpace(request.RequestId))
        {
            return BrokerResponse.Rejected(request, "Unsupported broker protocol.");
        }

        if (!actions.TryGetValue(request.ActionId, out var action))
        {
            return BrokerResponse.Rejected(request, "This action is not published by the OPT / LAB Broker.");
        }

        if (action.IsSystemMutation)
        {
            return BrokerResponse.Rejected(request, "No Windows mutation action is published in this build.");
        }

        var payload = await action.ExecuteAsync(request.Arguments, cancellationToken);
        return BrokerResponse.Completed(request, payload);
    }
}

