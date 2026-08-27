using System.Text.Json;

namespace OptLab.Broker;

public sealed record BrokerRequest(
    int ProtocolVersion,
    string RequestId,
    string ModuleId,
    string ActionId,
    JsonElement Arguments);

public sealed record BrokerResponse(
    int ProtocolVersion,
    string RequestId,
    bool Accepted,
    string Status,
    string? Message,
    JsonElement? Payload)
{
    public static BrokerResponse Rejected(BrokerRequest request, string message) =>
        new(1, request.RequestId, false, "rejected", message, null);

    public static BrokerResponse Completed(BrokerRequest request, JsonElement payload) =>
        new(1, request.RequestId, true, "completed", null, payload);
}

