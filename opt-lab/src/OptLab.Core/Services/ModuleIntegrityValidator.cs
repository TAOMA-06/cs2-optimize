using System.Security.Cryptography;
using System.Text;
using OptLab.Core.Contracts;

namespace OptLab.Core.Services;

public interface IModuleSignatureVerifier
{
    bool Verify(ReadOnlySpan<byte> payload, ModuleSignature signature);
}

public sealed class RsaPssModuleSignatureVerifier : IModuleSignatureVerifier
{
    private readonly IReadOnlyDictionary<string, string> publicKeysById;

    public RsaPssModuleSignatureVerifier(IReadOnlyDictionary<string, string> publicKeysById)
    {
        this.publicKeysById = publicKeysById;
    }

    public bool Verify(ReadOnlySpan<byte> payload, ModuleSignature signature)
    {
        if (!string.Equals(signature.Algorithm, "RSA-PSS-SHA256", StringComparison.Ordinal) ||
            !publicKeysById.TryGetValue(signature.KeyId, out var publicKey))
        {
            return false;
        }

        try
        {
            using var rsa = RSA.Create();
            rsa.ImportFromPem(publicKey);
            return rsa.VerifyData(
                payload,
                Convert.FromBase64String(signature.Value),
                HashAlgorithmName.SHA256,
                RSASignaturePadding.Pss);
        }
        catch (CryptographicException)
        {
            return false;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}

public sealed class ModuleIntegrityValidator
{
    private readonly IModuleSignatureVerifier signatureVerifier;

    public ModuleIntegrityValidator(IModuleSignatureVerifier signatureVerifier)
    {
        this.signatureVerifier = signatureVerifier;
    }

    public void Validate(ModuleManifest manifest, ReadOnlySpan<byte> payload)
    {
        manifest.ValidateStructure();

        var actualHash = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(actualHash),
                Encoding.ASCII.GetBytes(manifest.ContentHash.ToLowerInvariant())))
        {
            throw new InvalidOperationException($"Module payload hash does not match manifest for {manifest.Id}.");
        }

        if (!signatureVerifier.Verify(manifest.CanonicalSignaturePayload(), manifest.Signature))
        {
            throw new InvalidOperationException($"Module signature verification failed for {manifest.Id}.");
        }
    }
}

