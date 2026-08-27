using System.Text.Json;

namespace OptLab.Core.Contracts;

public enum ModuleKind
{
    Calibration,
    Optimizer,
    Diagnostics,
    Reference
}

public enum PermissionLevel
{
    None,
    ReadSystemState,
    ModifySystemState
}

public enum OptimizationPersistence
{
    UntilRestored
}

public enum TransactionStatus
{
    Planned,
    Snapshotted,
    Applying,
    Verified,
    RestoreRequired,
    Restored,
    Failed
}

public sealed record ModulePermission(string Id, PermissionLevel Level, string Rationale);

public sealed record WorkflowDescriptor(
    string Id,
    string Name,
    string Description,
    OptimizationPersistence Persistence,
    bool RequiresElevation);

public sealed record ModuleSignature(string Algorithm, string KeyId, string Value);

public sealed record ModuleManifest(
    int SchemaVersion,
    string Id,
    string Name,
    string Version,
    ModuleKind Kind,
    string EntryPoint,
    string MinimumHostVersion,
    IReadOnlyList<ModulePermission> Permissions,
    IReadOnlyList<WorkflowDescriptor> Workflows,
    string ContentHash,
    ModuleSignature Signature)
{
    public void ValidateStructure()
    {
        if (SchemaVersion != 1)
        {
            throw new InvalidOperationException($"Unsupported module schema: {SchemaVersion}.");
        }

        if (string.IsNullOrWhiteSpace(Id) || !Id.All(static character => char.IsLower(character) || char.IsDigit(character) || character is '.' or '-'))
        {
            throw new InvalidOperationException("Module id must use lowercase letters, digits, dots, or hyphens.");
        }

        if (string.IsNullOrWhiteSpace(EntryPoint) || EntryPoint.StartsWith('/') || EntryPoint.Contains("..", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Module entry point must be a relative path.");
        }

        if (string.IsNullOrWhiteSpace(ContentHash) || ContentHash.Length != 64)
        {
            throw new InvalidOperationException("Module content hash must be a SHA-256 hex digest.");
        }

        if (!string.Equals(Signature.Algorithm, "RSA-PSS-SHA256", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Only RSA-PSS-SHA256 module signatures are accepted.");
        }
    }

    public byte[] CanonicalSignaturePayload() =>
        System.Text.Encoding.UTF8.GetBytes($"{Id}\n{Version}\n{ContentHash.ToLowerInvariant()}");
}

public sealed record HostMessage(
    int ProtocolVersion,
    string Type,
    string RequestId,
    string ModuleId,
    JsonElement Payload);

public sealed record CalibrationResult(
    string ModuleId,
    DateTimeOffset CompletedAt,
    decimal Sensitivity,
    decimal PrecisionSensitivity,
    decimal SpeedSensitivity,
    int EffectiveDpi,
    decimal CentimetersPer360,
    string Confidence,
    string Command);

public sealed record ActionRequest(
    string ActionId,
    JsonElement Arguments,
    string DisplayName,
    string Rationale);

public sealed record OptimizationPlan(
    Guid PlanId,
    string ModuleId,
    string WorkflowId,
    OptimizationPersistence Persistence,
    IReadOnlyList<ActionRequest> Actions);

public sealed record ActionExecutionRecord(
    string ActionId,
    TransactionStatus Status,
    JsonElement Snapshot,
    string? VerificationMessage,
    string? FailureMessage);

public sealed record TransactionRecord(
    Guid TransactionId,
    string ModuleId,
    string WorkflowId,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    TransactionStatus Status,
    IReadOnlyList<ActionExecutionRecord> Actions);

