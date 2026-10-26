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

    public List<InstalledDll> Dlls { get; } = new();

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
