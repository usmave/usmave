using System.Text.Json;
using System.Text.Json.Serialization;
using NeuralSwap.Core.Presets;

namespace NeuralSwap.Core;

/// <summary>Einstellungen der App, gespeichert unter %LOCALAPPDATA%\NeuralSwap\settings.json.</summary>
public sealed class AppSettings
{
    public const int CurrentVersion = 2;

    /// <summary>Fehlt in Dateien früherer Versionen (dann 0) – Grundlage der Migration.</summary>
    [JsonPropertyName("settingsVersion")] public int SettingsVersion { get; set; }

    [JsonPropertyName("manualFolders")] public List<string> ManualFolders { get; set; } = new();

    /// <summary>URL des Versions-Manifests; leer = nur lokale Datei verwenden.</summary>
    [JsonPropertyName("manifestUrl")] public string? ManifestUrl { get; set; }

    /// <summary>Zu erzwingendes DLSS-Preset: default, latest, M, L oder K.</summary>
    [JsonPropertyName("preferredPreset")] public string PreferredPreset { get; set; } = "latest";

    /// <summary>Beim One-Click auch das Preset erzwingen (nur in Spielen mit OptiScaler wirksam)?</summary>
    [JsonPropertyName("forcePresetOnOneClick")] public bool ForcePresetOnOneClick { get; set; }

    /// <summary>Bevorzugter Proxy-DLL-Name für OptiScaler-Installationen.</summary>
    [JsonPropertyName("optiScalerProxy")] public string OptiScalerProxy { get; set; } = "dxgi.dll";

    /// <summary>True, wenn beim Laden ein veraltetes Preset (z. B. „B“) zurückgesetzt wurde.</summary>
    [JsonIgnore] public bool PresetMigrated { get; private set; }

    private static readonly Dictionary<string, PresetChoice> PresetIds = new(StringComparer.OrdinalIgnoreCase)
    {
        ["default"] = PresetChoice.GameDefault,
        ["latest"] = PresetChoice.Latest,
        ["M"] = PresetChoice.M,
        ["L"] = PresetChoice.L,
        ["K"] = PresetChoice.K,
    };

    [JsonIgnore]
    public PresetChoice PreferredPresetChoice
    {
        get => PresetIds.TryGetValue(PreferredPreset, out var c) ? c : PresetChoice.Latest;
        set => PreferredPreset = PresetIds.First(p => p.Value == value).Key;
    }

    public static string DefaultPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NeuralSwap", "settings.json");

    public static AppSettings Load(string? path = null)
    {
        path ??= DefaultPath;
        AppSettings? settings = null;
        try
        {
            if (File.Exists(path))
                settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path));
        }
        catch (Exception) { /* defekte Settings → Standardwerte */ }

        if (settings == null) return new AppSettings { SettingsVersion = CurrentVersion };
        settings.Migrate();
        return settings;
    }

    /// <summary>
    /// Version 1 hat „B“ als Preset gespeichert und beim One-Click erzwungen. B ist
    /// für das Upscaling aber ein entferntes Alt-Preset (OptiScaler: „Removed on
    /// recent versions!“) und wurde zudem als Buchstabe geschrieben, den OptiScaler
    /// als Zahl erwartet – es hat also nie gewirkt. Daher: zurücksetzen und aus.
    /// </summary>
    private void Migrate()
    {
        if (SettingsVersion >= CurrentVersion) return;
        if (!PresetIds.ContainsKey(PreferredPreset))
        {
            PreferredPreset = "latest";
            ForcePresetOnOneClick = false;
            PresetMigrated = true;
        }
        SettingsVersion = CurrentVersion;
    }

    public void Save(string? path = null)
    {
        path ??= DefaultPath;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
