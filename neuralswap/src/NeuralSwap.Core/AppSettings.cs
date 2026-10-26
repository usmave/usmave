using System.Text.Json;
using System.Text.Json.Serialization;

namespace NeuralSwap.Core;

/// <summary>Einstellungen der App, gespeichert unter %LOCALAPPDATA%\NeuralSwap\settings.json.</summary>
public sealed class AppSettings
{
    [JsonPropertyName("manualFolders")] public List<string> ManualFolders { get; set; } = new();

    /// <summary>URL des Versions-Manifests; leer = nur lokale Datei verwenden.</summary>
    [JsonPropertyName("manifestUrl")] public string? ManifestUrl { get; set; }

    /// <summary>Bevorzugtes Render-Preset (z. B. "B" für das neue Neural-Rendering-Modell).</summary>
    [JsonPropertyName("preferredPreset")] public string PreferredPreset { get; set; } = "B";

    /// <summary>Beim One-Click auch das Preset erzwingen?</summary>
    [JsonPropertyName("forcePresetOnOneClick")] public bool ForcePresetOnOneClick { get; set; } = true;

    /// <summary>Proxy-DLL-Name für OptiScaler-Installationen.</summary>
    [JsonPropertyName("optiScalerProxy")] public string OptiScalerProxy { get; set; } = "dxgi.dll";

    public static string DefaultPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NeuralSwap", "settings.json");

    public static AppSettings Load(string? path = null)
    {
        path ??= DefaultPath;
        try
        {
            if (File.Exists(path))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path)) ?? new AppSettings();
        }
        catch (Exception) { /* defekte Settings → Standardwerte */ }
        return new AppSettings();
    }

    public void Save(string? path = null)
    {
        path ??= DefaultPath;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
