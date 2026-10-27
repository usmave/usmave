using System.Diagnostics;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.Pe;
using NeuralSwap.Core.Presets;

namespace NeuralSwap.Core.NeuralRendering;

public enum NeuralConsumer
{
    None,

    /// <summary>Krishs renodx-dlss5 – hängt sich in die DLSS-Aufrufe des Spiels.</summary>
    RenoDxDlss5,

    /// <summary>Deep Fried Chicken (Alexander).</summary>
    DeepFriedChicken,

    /// <summary>ShortFuses renodx-dlss – baut die DLSS-Anfrage selbst.</summary>
    RenoDxDlssShortFuse,
}

/// <summary>Was im Mod-Ordner eines Spiels in Sachen Neural Rendering liegt.</summary>
public sealed record NrStatus
{
    /// <summary>Dateinamen, unter denen ReShade lokal neben der Spiel-EXE liegen kann.</summary>
    public static readonly string[] ReShadeModuleNames =
        { "dxgi.dll", "d3d9.dll", "d3d10.dll", "d3d11.dll", "d3d12.dll", "opengl32.dll", "ddraw.dll", "dinput8.dll" };

    public required string ModDir { get; init; }
    public bool UsesStreamline { get; init; }
    public bool ReShadePresent { get; init; }
    public NeuralConsumer Consumer { get; init; }
    public string? ConsumerFile { get; init; }
    public bool FeederPresent { get; init; }
    public bool OptiScalerPresent { get; init; }

    /// <summary>DLSS5oneclick hat hier etwas installiert (es legt *.dlss5oneclick-Marker ab).</summary>
    public bool InstalledByDlss5OneClick { get; init; }

    /// <summary>Wert von [RenoDX.DLSS5] EnableHooks in ReShade.ini (null = nicht gesetzt).</summary>
    public string? EnableHooks { get; init; }

    public bool HasNeuralRendering => Consumer != NeuralConsumer.None || InstalledByDlss5OneClick;

    public string Describe()
    {
        var parts = new List<string>
        {
            Consumer switch
            {
                NeuralConsumer.RenoDxDlss5 => "Neural Rendering: renodx-dlss5",
                NeuralConsumer.DeepFriedChicken => "Neural Rendering: Deep Fried Chicken",
                NeuralConsumer.RenoDxDlssShortFuse => "Neural Rendering: renodx-dlss (ShortFuse)",
                _ => InstalledByDlss5OneClick ? "Neural Rendering: installiert" : "Neural Rendering: nicht installiert",
            },
        };
        if (InstalledByDlss5OneClick) parts.Add("über DLSS5oneclick");
        parts.Add(ReShadePresent ? "ReShade: ja" : "ReShade: nein");
        if (UsesStreamline) parts.Add("Streamline: ja");
        if (FeederPresent) parts.Add("Feeder: ja");
        if (OptiScalerPresent) parts.Add("OptiScaler: ja");
        if (EnableHooks != null) parts.Add($"EnableHooks={EnableHooks}");
        return string.Join(" · ", parts);
    }

    public static NrStatus Detect(Game game)
    {
        var modDir = game.ModDir;
        var consumer = NeuralConsumer.None;
        string? consumerFile = null;
        var feeder = false;
        var marker = false;

        if (Directory.Exists(modDir))
        {
            foreach (var file in Directory.EnumerateFiles(modDir))
            {
                var name = Path.GetFileName(file).ToLowerInvariant();
                if (name.EndsWith(".dlss5oneclick")) { marker = true; continue; }
                if (!name.EndsWith(".addon64") && !name.EndsWith(".addon32")) continue;
                if (name.StartsWith("dlss5-feed")) { feeder = true; continue; }

                var found = name.StartsWith("deep-fried-chicken") ? NeuralConsumer.DeepFriedChicken
                    : name.StartsWith("renodx-dlss5") ? NeuralConsumer.RenoDxDlss5
                    : name.StartsWith("renodx-dlss") ? NeuralConsumer.RenoDxDlssShortFuse
                    : NeuralConsumer.None;
                if (found != NeuralConsumer.None && consumer == NeuralConsumer.None)
                {
                    consumer = found;
                    consumerFile = file;
                }
            }
        }

        var reShadeIni = Path.Combine(modDir, "ReShade.ini");
        return new NrStatus
        {
            ModDir = modDir,
            UsesStreamline = game.UsesStreamline,
            ReShadePresent = File.Exists(reShadeIni) || ReShadeModuleNames.Any(n => IsReShadeModule(Path.Combine(modDir, n))),
            Consumer = consumer,
            ConsumerFile = consumerFile,
            FeederPresent = feeder,
            OptiScalerPresent = HasOptiScaler(modDir),
            InstalledByDlss5OneClick = marker,
            EnableHooks = File.Exists(reShadeIni) ? IniFile.Load(reShadeIni).Get("RenoDX.DLSS5", "EnableHooks") : null,
        };
    }

    /// <summary>ReShade erkennt man an seinem Export ReShadeRegisterAddon oder am Produktnamen.</summary>
    public static bool IsReShadeModule(string path)
    {
        if (!File.Exists(path)) return false;
        if (PeInfo.TryRead(path) is { } pe && pe.Exports.Contains("ReShadeRegisterAddon")) return true;
        return ProductName(path)?.Contains("reshade", StringComparison.OrdinalIgnoreCase) == true;
    }

    public static bool HasOptiScaler(string modDir)
    {
        if (File.Exists(Path.Combine(modDir, "OptiScaler.ini")) || File.Exists(Path.Combine(modDir, "OptiScaler.dll")))
            return true;
        return OptiScaler.OptiScalerInstaller.ProxyNames.Any(name =>
            ProductName(Path.Combine(modDir, name))?.Contains("OptiScaler", StringComparison.OrdinalIgnoreCase) == true);
    }

    internal static string? ProductName(string path)
    {
        try { return File.Exists(path) ? FileVersionInfo.GetVersionInfo(path).ProductName : null; }
        catch (Exception) { return null; }
    }
}
