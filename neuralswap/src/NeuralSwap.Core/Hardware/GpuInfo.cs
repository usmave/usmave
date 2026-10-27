using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace NeuralSwap.Core.Hardware;

/// <summary>
/// Erkennt die NVIDIA-Grafikkarte. Wichtig für das Neural-Rendering-Modell:
/// NVIDIAs offizielle nvngx_dlssnr.dll (z. B. 310.9.16 aus Metro Redux/NBA 2K27)
/// erzeugt das neuronale Feature nur auf RTX 50; ältere Karten brauchen den
/// Multi-Generationen-Build („SF“), den DLSS5oneclick installiert.
/// </summary>
public static class GpuInfo
{
    private const string DisplayClassKey =
        @"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";

    private static readonly Regex Rtx50 = new(@"RTX\s*50\d{2}|Blackwell", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Name der ersten NVIDIA-Grafikkarte laut Treiber, z. B. „NVIDIA GeForce RTX 5090“.</summary>
    public static string? NvidiaAdapterName()
    {
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            using var classKey = Registry.LocalMachine.OpenSubKey(DisplayClassKey);
            if (classKey == null) return null;
            foreach (var sub in classKey.GetSubKeyNames().Where(n => n.All(char.IsDigit)))
            {
                using var adapter = classKey.OpenSubKey(sub);
                if (adapter?.GetValue("DriverDesc") is string name &&
                    name.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase))
                    return name;
            }
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException) { }
        return null;
    }

    public static bool IsRtx50(string? adapterName) => adapterName != null && Rtx50.IsMatch(adapterName);
}
