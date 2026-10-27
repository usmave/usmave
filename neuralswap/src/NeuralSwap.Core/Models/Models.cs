namespace NeuralSwap.Core.Models;

/// <summary>Plattform, über die ein Spiel installiert wurde.</summary>
public enum GamePlatform
{
    Steam,
    Epic,
    Gog,
    Xbox,
    Manual,
}

/// <summary>Art der NVIDIA-NGX-DLL, die getauscht werden kann.</summary>
public enum DlssDllKind
{
    /// <summary>nvngx_dlss.dll – Super Resolution (klassisches Upscaling).</summary>
    SuperResolution,

    /// <summary>nvngx_dlssg.dll – Frame Generation / Multi Frame Generation.</summary>
    FrameGeneration,

    /// <summary>nvngx_dlssd.dll – Ray Reconstruction (Denoiser).</summary>
    RayReconstruction,

    /// <summary>nvngx_dlssnr.dll – DLSS 5 Neural Rendering.</summary>
    NeuralRendering,
}

public static class DlssDllKinds
{
    public static readonly IReadOnlyDictionary<string, DlssDllKind> ByFileName =
        new Dictionary<string, DlssDllKind>(StringComparer.OrdinalIgnoreCase)
        {
            ["nvngx_dlss.dll"] = DlssDllKind.SuperResolution,
            ["nvngx_dlssg.dll"] = DlssDllKind.FrameGeneration,
            ["nvngx_dlssd.dll"] = DlssDllKind.RayReconstruction,
            ["nvngx_dlssnr.dll"] = DlssDllKind.NeuralRendering,
        };

    public static string FileName(this DlssDllKind kind) => kind switch
    {
        DlssDllKind.SuperResolution => "nvngx_dlss.dll",
        DlssDllKind.FrameGeneration => "nvngx_dlssg.dll",
        DlssDllKind.RayReconstruction => "nvngx_dlssd.dll",
        DlssDllKind.NeuralRendering => "nvngx_dlssnr.dll",
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    public static string DisplayName(this DlssDllKind kind) => kind switch
    {
        DlssDllKind.SuperResolution => "DLSS Super Resolution",
        DlssDllKind.FrameGeneration => "DLSS Frame Generation",
        DlssDllKind.RayReconstruction => "DLSS Ray Reconstruction",
        DlssDllKind.NeuralRendering => "DLSS 5 Neural Rendering",
        _ => kind.ToString(),
    };
}

/// <summary>Ein gefundenes Spiel.</summary>
public sealed class Game
{
    public required string Name { get; init; }
    public required string InstallDir { get; init; }
    public required GamePlatform Platform { get; init; }

    /// <summary>Xbox/Game-Pass-Titel sind durch UWP-Schutz oft nicht modbar.</summary>
    public bool LimitedModSupport => Platform == GamePlatform.Xbox;

    /// <summary>
    /// Vom Laufwerks-Scan geraten (kein Launcher-Eintrag, kein manueller Ordner).
    /// Solche Einträge werden verworfen, wenn sie andere Spiele enthalten.
    /// </summary>
    public bool AutoDetected { get; init; }

    public List<InstalledDll> Dlls { get; } = new();

    /// <summary>
    /// Die eigentliche Spiel-EXE (bei Unreal-Spielen die Shipping-EXE unter
    /// Binaries\Win64 bzw. WinGDK, nicht der kleine Starter im Hauptordner).
    /// </summary>
    public string? MainExe { get; set; }

    /// <summary>True, wenn das Spiel DLSS über NVIDIA Streamline (sl.interposer.dll) lädt.</summary>
    public bool UsesStreamline { get; set; }

    /// <summary>
    /// Ordner, in den Proxy-DLLs (ReShade, OptiScaler), Add-ons und deren
    /// Konfiguration gehören: der Ordner der Spiel-EXE, sonst der Spielordner.
    /// </summary>
    public string ModDir => MainExe != null ? System.IO.Path.GetDirectoryName(MainExe)! : InstallDir;

    public override string ToString() => $"{Name} [{Platform}]";
}

/// <summary>Eine im Spielordner gefundene DLSS-DLL.</summary>
public sealed class InstalledDll
{
    public required DlssDllKind Kind { get; init; }
    public required string Path { get; init; }

    /// <summary>Dateiversion, z. B. "310.9.16.0". Null, wenn nicht lesbar.</summary>
    public string? Version { get; set; }

    /// <summary>True, wenn neben der DLL ein NeuralSwap-Backup liegt.</summary>
    public bool HasBackup { get; set; }
}
