using System.Globalization;
using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Presets;

/// <summary>Erzwungene Render-Stärke (interne Auflösung) für DLSS.</summary>
public enum QualityMode
{
    /// <summary>Nichts erzwingen – das Spiel entscheidet.</summary>
    GameDefault,

    /// <summary>DLAA: native Auflösung, maximale Qualität.</summary>
    Dlaa,

    /// <summary>Qualität: Faktor 1,5 (render bei 66,7 %).</summary>
    Quality,

    /// <summary>Ausgewogen: Faktor ~1,7 (render bei 58 %).</summary>
    Balanced,

    /// <summary>Performance: Faktor 2,0 (render bei 50 %).</summary>
    Performance,

    /// <summary>Ultra Performance: Faktor 3,0 (render bei 33,3 %).</summary>
    UltraPerformance,
}

/// <summary>
/// Stellt „Stärke" (Qualitätsmodus/interne Auflösung) und Schärfe pro Spiel
/// ein – über die OptiScaler.ini (exakte Schlüssel aus dem OptiScaler-Repo)
/// oder ersatzweise die dlsstweaks.ini. Der erzwungene Modus überschreibt
/// alle Qualitätsstufen, damit er unabhängig von der In-Game-Auswahl greift.
/// </summary>
public static class QualityTweaker
{
    public sealed record TweakResult(bool Success, string Message, string? ConfigFile);

    /// <summary>Upscale-Faktor je Modus (OptiScaler: Ratio, z. B. 2.0 = halbe Auflösung).</summary>
    public static double Ratio(QualityMode mode) => mode switch
    {
        QualityMode.Dlaa => 1.0,
        QualityMode.Quality => 1.5,
        QualityMode.Balanced => 1.7,
        QualityMode.Performance => 2.0,
        QualityMode.UltraPerformance => 3.0,
        _ => 0,
    };

    /// <summary>Render-Skalierung je Modus (DLSSTweaks: Bruchteil, z. B. 0.5 = halbe Auflösung).</summary>
    public static double Fraction(QualityMode mode) => mode switch
    {
        QualityMode.Dlaa => 1.0,
        QualityMode.Quality => 0.666667,
        QualityMode.Balanced => 0.58,
        QualityMode.Performance => 0.5,
        QualityMode.UltraPerformance => 0.333333,
        _ => 0,
    };

    /// <summary>
    /// Wendet Stärke und optional Schärfe (0..1) an.
    /// </summary>
    public static TweakResult Apply(Game game, QualityMode mode, double? sharpness = null)
    {
        if (sharpness is < 0 or > 1)
            return new TweakResult(false, "Schärfe muss zwischen 0 und 1 liegen.", null);

        var optiScalerIni = PresetForcer.FindOptiScalerIni(game);
        if (optiScalerIni != null)
            return ApplyOptiScaler(optiScalerIni, mode, sharpness);

        return new TweakResult(false,
            "Kein OptiScaler im Spiel – Stärke und Schärfe lassen sich dann über die NVIDIA App einstellen " +
            "(Grafik → Programmeinstellungen → DLSS-Override → Super Resolution). Alternativ OptiScaler installieren.",
            null);
    }

    private static TweakResult ApplyOptiScaler(string iniPath, QualityMode mode, double? sharpness)
    {
        try
        {
            var ini = IniFile.Load(iniPath);

            if (mode == QualityMode.GameDefault)
            {
                ini.Set("QualityOverrides", "QualityRatioOverrideEnabled", "false");
            }
            else
            {
                // Alle Stufen auf denselben Faktor: so greift die gewählte
                // Stärke unabhängig davon, welchen Modus das Spiel anfordert.
                var ratio = Ratio(mode).ToString("0.0###", CultureInfo.InvariantCulture);
                ini.Set("QualityOverrides", "QualityRatioOverrideEnabled", "true");
                foreach (var key in new[] { "QualityRatioDLAA", "QualityRatioUltraQuality", "QualityRatioQuality",
                                            "QualityRatioBalanced", "QualityRatioPerformance", "QualityRatioUltraPerformance" })
                    ini.Set("QualityOverrides", key, ratio);
            }

            if (sharpness.HasValue)
            {
                ini.Set("Sharpness", "OverrideSharpness", "true");
                ini.Set("Sharpness", "Sharpness", sharpness.Value.ToString("0.0##", CultureInfo.InvariantCulture));
            }

            ini.Save(iniPath);
            var what = mode == QualityMode.GameDefault ? "Stärke-Override deaktiviert" : $"Stärke {mode} (Faktor {Ratio(mode):0.0})";
            if (sharpness.HasValue) what += $", Schärfe {sharpness:P0}";
            return new TweakResult(true, $"{what} über OptiScaler.ini gesetzt. Feintuning im Spiel: Einfg-Taste öffnet das OptiScaler-Menü.", iniPath);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new TweakResult(false, $"Konnte {iniPath} nicht schreiben: {ex.Message}", null);
        }
    }
}
