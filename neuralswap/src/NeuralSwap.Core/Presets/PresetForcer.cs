using System.Globalization;
using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Presets;

/// <summary>DLSS-Upscaling-Preset (Super Resolution), das erzwungen werden soll.</summary>
public enum PresetChoice
{
    /// <summary>Nichts erzwingen – Spiel bzw. DLL entscheiden.</summary>
    GameDefault,

    /// <summary>Neuestes Preset, das die DLL kennt (OptiScaler „Latest“).</summary>
    Latest,

    /// <summary>Preset M – 2. Gen. Transformer (DLSS 4.5), Standard für Performance.</summary>
    M,

    /// <summary>Preset L – 2. Gen. Transformer (DLSS 4.5), Standard für Ultra Performance.</summary>
    L,

    /// <summary>Preset K – 1. Gen. Transformer (DLSS 4), Standard für DLAA/Qualität/Ausgewogen.</summary>
    K,
}

/// <summary>
/// Erzwingt ein DLSS-Preset über die OptiScaler.ini des Spiels. OptiScaler liest
/// die Werte als Zahl (NGX-Enum: K=11, L=12, M=13; „Latest“ = 0x00FFFFFF) – so im
/// OptiScaler-Quelltext (Config.cpp/menu_common.cpp) nachgeprüft. Ohne OptiScaler
/// wird nichts geschrieben; dann ist der Treiber-Override der NVIDIA App der Weg.
/// Hinweis: Das Neural-Rendering-Modell wird nicht hier, sondern im
/// renodx-dlss5-Overlay gewählt.
/// </summary>
public static class PresetForcer
{
    public const int OptiScalerLatest = 0x00FFFFFF;

    public sealed record PresetResult(bool Applied, string Message, string? ConfigFile);

    public static int? OptiScalerValue(PresetChoice choice) => choice switch
    {
        PresetChoice.Latest => OptiScalerLatest,
        PresetChoice.M => 13,
        PresetChoice.L => 12,
        PresetChoice.K => 11,
        _ => null,
    };

    public static string Label(PresetChoice choice) => choice switch
    {
        PresetChoice.GameDefault => "Spiel entscheidet",
        PresetChoice.Latest => "Neuestes (Latest)",
        PresetChoice.M => "M – DLSS 4.5 (Performance)",
        PresetChoice.L => "L – DLSS 4.5 (Ultra Perf.)",
        PresetChoice.K => "K – DLSS 4 (Qualität/DLAA)",
        _ => choice.ToString(),
    };

    public static string? FindOptiScalerIni(Game game) =>
        new[] { game.ModDir }
            .Concat(game.Dlls.Select(d => Path.GetDirectoryName(d.Path)!))
            .Append(game.InstallDir)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(dir => Path.Combine(dir, "OptiScaler.ini"))
            .FirstOrDefault(File.Exists);

    public static PresetResult Apply(Game game, PresetChoice choice)
    {
        var path = FindOptiScalerIni(game);
        if (path == null)
            return new PresetResult(false,
                "kein OptiScaler im Spiel – Preset lässt sich hier nur per NVIDIA App (Grafik → DLSS-Override → Modell-Presets) setzen.",
                null);

        try
        {
            var ini = IniFile.Load(path);
            var value = OptiScalerValue(choice);
            if (value == null)
            {
                ini.Set("DLSS", "RenderPresetOverride", "false");
            }
            else
            {
                ini.Set("DLSS", "RenderPresetOverride", "true");
                ini.Set("DLSS", "RenderPresetForAll", value.Value.ToString(CultureInfo.InvariantCulture));
            }
            ini.Save(path);
            return new PresetResult(true, $"Preset „{Label(choice)}“ in OptiScaler.ini gesetzt.", path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new PresetResult(false, $"OptiScaler.ini nicht beschreibbar: {ex.Message}", null);
        }
    }
}
