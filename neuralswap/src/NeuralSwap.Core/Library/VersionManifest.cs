using System.Text.Json;
using System.Text.Json.Serialization;
using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Library;

/// <summary>
/// Aktualisierbarer Versionskatalog. Die App liest ihn aus einer JSON-Datei
/// (lokal mitgeliefert und/oder von einer konfigurierbaren URL), damit neue
/// DLSS-Versionen ohne App-Update nutzbar sind.
/// Wichtig: NVIDIA-DLLs dürfen nicht einfach weiterverbreitet werden – das
/// Manifest enthält deshalb nur Metadaten und Quell-URLs, nie die DLL selbst.
/// </summary>
public sealed class VersionManifest
{
    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; } = 1;
    [JsonPropertyName("updatedAt")] public string? UpdatedAt { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
    [JsonPropertyName("dlls")] public List<ManifestDll> Dlls { get; set; } = new();
    [JsonPropertyName("presets")] public Dictionary<string, ManifestPreset> Presets { get; set; } = new();
    [JsonPropertyName("optiscalerRepo")] public string OptiScalerRepo { get; set; } = "optiscaler/OptiScaler";
    [JsonPropertyName("dlss5oneclick")] public NeuralRendering.Dlss5OneClickSource Dlss5OneClick { get; set; } = new();

    public static VersionManifest Parse(string json) =>
        JsonSerializer.Deserialize<VersionManifest>(json, JsonOptions)
        ?? throw new JsonException("Manifest ist leer.");

    public string ToJson() => JsonSerializer.Serialize(this, JsonOptions);

    /// <summary>Neuester Manifest-Eintrag je DLL-Art.</summary>
    public ManifestDll? Latest(DlssDllKind kind) =>
        Dlls.Where(d => DlssDllKinds.ByFileName.TryGetValue(d.FileName, out var k) && k == kind)
            .OrderByDescending(d => DllLibrary.ParseVersion(d.Version))
            .FirstOrDefault();

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}

public sealed class ManifestDll
{
    [JsonPropertyName("fileName")] public required string FileName { get; set; }
    [JsonPropertyName("version")] public required string Version { get; set; }

    /// <summary>Optionaler SHA-256-Hash zur Verifikation des Downloads.</summary>
    [JsonPropertyName("sha256")] public string? Sha256 { get; set; }

    /// <summary>Download-Quellen; die erste erreichbare wird genutzt.</summary>
    [JsonPropertyName("sources")] public List<ManifestSource> Sources { get; set; } = new();

    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

public sealed class ManifestSource
{
    [JsonPropertyName("name")] public required string Name { get; set; }
    [JsonPropertyName("url")] public required string Url { get; set; }
}

public sealed class ManifestPreset
{
    [JsonPropertyName("recommended")] public required string Recommended { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
}
