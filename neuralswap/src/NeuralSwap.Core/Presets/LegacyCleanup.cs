using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Presets;

/// <summary>
/// Frühere NeuralSwap-Versionen haben in Spielen ohne DLSSTweaks-Loader eine
/// dlsstweaks.ini angelegt, die nie etwas bewirkt hat. Diese Dateien werden an
/// ihrem exakten Aufbau erkannt (nur unsere Schlüssel, keine Kommentare – die
/// echte DLSSTweaks-INI ist ausführlich kommentiert) und entfernt.
/// </summary>
public static class LegacyCleanup
{
    private static readonly Dictionary<string, string[]> OurKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        ["DLSSPresets"] = new[] { "Global" },
        ["DLSS"] = new[] { "ForceDLAA" },
        ["DLSSQualityLevels"] = new[] { "Enable", "UltraQuality", "Quality", "Balanced", "Performance", "UltraPerformance" },
    };

    public static bool IsOurDlssTweaksIni(IEnumerable<string> lines)
    {
        string? section = null;
        var keys = 0;
        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.Length == 0) continue;
            if (line.StartsWith('[') && line.EndsWith(']'))
            {
                section = line[1..^1].Trim();
                if (!OurKeys.ContainsKey(section)) return false;
                continue;
            }
            var eq = line.IndexOf('=');
            if (section == null || eq <= 0) return false;
            var key = line[..eq].Trim();
            if (!OurKeys[section].Contains(key, StringComparer.OrdinalIgnoreCase)) return false;
            keys++;
        }
        return keys > 0;
    }

    /// <summary>Entfernt wirkungslose dlsstweaks.ini-Dateien früherer Versionen; liefert die Anzahl.</summary>
    public static int RemoveInertDlssTweaksIni(Game game)
    {
        var removed = 0;
        var dirs = new[] { game.ModDir, game.InstallDir }
            .Concat(game.Dlls.Select(d => Path.GetDirectoryName(d.Path)!))
            .Distinct(StringComparer.OrdinalIgnoreCase);
        foreach (var dir in dirs)
        {
            var ini = Path.Combine(dir, "dlsstweaks.ini");
            try
            {
                // Mit DLSSTweaks-Loader (nvngx.dll) ist die Datei womöglich gewollt.
                if (!File.Exists(ini) || File.Exists(Path.Combine(dir, "nvngx.dll"))) continue;
                if (!IsOurDlssTweaksIni(File.ReadLines(ini))) continue;
                File.Delete(ini);
                removed++;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        return removed;
    }
}
