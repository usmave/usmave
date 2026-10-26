using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Presets;

/// <summary>
/// Erzwingt ein DLSS-Render-Preset pro Spiel (z. B. Preset B = neues
/// Neural-Rendering-Modell), indem die Konfiguration des im Spiel vorhandenen
/// Mod-Loaders angepasst wird:
///  - OptiScaler.ini  → [Dlss] RenderPresetOverride / RenderPresetForAll
///  - dlsstweaks.ini  → [DLSSPresets] Global
/// Ist keiner von beiden vorhanden, wird eine dlsstweaks.ini vorbereitet und
/// das Ergebnis weist darauf hin, dass zusätzlich der DLSSTweaks-Loader oder
/// der Override der NVIDIA App nötig ist.
/// </summary>
public static class PresetForcer
{
    public static readonly string[] KnownPresets = { "A", "B", "C", "D", "E", "F", "J", "K" };

    public sealed record PresetResult(bool Success, string Message, string? ConfigFile);

    public static PresetResult Force(Game game, string preset)
    {
        preset = preset.Trim().ToUpperInvariant();
        if (!KnownPresets.Contains(preset))
            return new PresetResult(false, $"Unbekanntes Preset \"{preset}\". Erlaubt: {string.Join(", ", KnownPresets)}.", null);

        // Konfig-Dateien liegen neben der ausführbaren Datei; wir nehmen die
        // Ordner, in denen DLSS-DLLs gefunden wurden, plus den Spielordner.
        var candidateDirs = game.Dlls
            .Select(d => Path.GetDirectoryName(d.Path)!)
            .Append(game.InstallDir)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        foreach (var dir in candidateDirs)
        {
            var optiScalerIni = Directory.Exists(dir)
                ? Directory.EnumerateFiles(dir, "OptiScaler.ini").FirstOrDefault()
                : null;
            if (optiScalerIni != null)
            {
                var ini = IniFile.Load(optiScalerIni);
                ini.Set("DLSS", "RenderPresetOverride", "true");
                ini.Set("DLSS", "RenderPresetForAll", preset);
                ini.Save(optiScalerIni);
                return new PresetResult(true, $"Preset {preset} über OptiScaler.ini erzwungen.", optiScalerIni);
            }
        }

        foreach (var dir in candidateDirs)
        {
            var tweaksIni = Directory.Exists(dir)
                ? Directory.EnumerateFiles(dir, "dlsstweaks.ini").FirstOrDefault()
                : null;
            if (tweaksIni != null)
            {
                var ini = IniFile.Load(tweaksIni);
                ini.Set("DLSSPresets", "Global", preset);
                ini.Save(tweaksIni);
                return new PresetResult(true, $"Preset {preset} über dlsstweaks.ini erzwungen.", tweaksIni);
            }
        }

        // Kein Loader gefunden: Konfiguration vorbereiten und ehrlich sagen,
        // dass sie allein noch nicht greift.
        var targetDir = candidateDirs.FirstOrDefault(Directory.Exists) ?? game.InstallDir;
        var newIni = Path.Combine(targetDir, "dlsstweaks.ini");
        try
        {
            var ini = IniFile.Load(newIni);
            ini.Set("DLSSPresets", "Global", preset);
            ini.Save(newIni);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new PresetResult(false, $"Konnte {newIni} nicht schreiben: {ex.Message}", null);
        }

        return new PresetResult(true,
            $"dlsstweaks.ini mit Preset {preset} angelegt. Hinweis: Damit sie greift, muss zusätzlich " +
            "DLSSTweaks (nvngx-Loader) im Spielordner installiert sein – alternativ das Preset über " +
            "die NVIDIA App (Treiber-Override) setzen oder OptiScaler installieren.",
            newIni);
    }
}
