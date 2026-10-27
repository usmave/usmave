using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Scanning;

/// <summary>
/// Findet die eigentliche Spiel-EXE. Proxy-DLLs (ReShade, OptiScaler) und
/// Add-ons wirken nur im Ordner der Prozess-EXE – bei Unreal-Spielen ist das
/// &lt;Projekt&gt;\Binaries\Win64 (Steam) bzw. \Binaries\WinGDK (Game Pass),
/// nicht der Hauptordner mit dem kleinen Starter und nicht der Ordner des
/// DLSS-Plugins unter Engine\Plugins.
/// </summary>
public static class GameExeLocator
{
    public const int MaxDepth = 6;

    private static readonly string[] ExcludedNameParts =
    {
        "crashreport", "crashhandler", "crashpad", "unins", "redist", "vcredist", "vc_redist",
        "dxsetup", "dotnet", "prereq", "setup", "install", "updater", "easyanticheat",
        "beservice", "battleye", "cefprocess", "webhelper", "unitycrashhandler",
    };

    private static readonly string[] ExcludedDirNames =
    {
        "_commonredist", "commonredist", "redist", "__installer", "installer", "directx",
        "vcredist", "easyanticheat", "battleye", "support",
    };

    public static void Inspect(Game game)
    {
        game.MainExe = FindMainExe(game.InstallDir, game.Dlls.Select(d => d.Path));
        game.UsesStreamline = HasStreamline(game.InstallDir);
    }

    public static string? FindMainExe(string gameDir, IEnumerable<string> dlssDllPaths)
    {
        if (!Directory.Exists(gameDir)) return null;

        var candidates = EnumerateFiles(gameDir, "*.exe")
            .Where(f => !IsExcluded(gameDir, f))
            .Select(f => (Path: f, Size: SafeLength(f)))
            .ToList();
        if (candidates.Count == 0) return null;

        // 1) Unreal: <Projekt>\Binaries\Win64|WinGDK außerhalb von Engine\.
        var unreal = candidates.Where(c => IsUnrealBinariesDir(gameDir, Path.GetDirectoryName(c.Path)!)).ToList();
        if (unreal.Count > 0) return Largest(unreal);

        // 2) Ordner, in dem auch eine DLSS-DLL liegt (typisch bei Nicht-Unreal-Spielen).
        var dllDirs = new HashSet<string>(
            dlssDllPaths.Select(p => Path.GetDirectoryName(p)!), StringComparer.OrdinalIgnoreCase);
        var besideDll = candidates.Where(c => dllDirs.Contains(Path.GetDirectoryName(c.Path)!)).ToList();
        if (besideDll.Count > 0) return Largest(besideDll);

        // 3) Sonst die größte EXE – Starter und Launcher sind fast immer klein.
        return Largest(candidates);
    }

    public static bool HasStreamline(string gameDir) =>
        Directory.Exists(gameDir) && EnumerateFiles(gameDir, "sl.interposer.dll").Any();

    private static string Largest(List<(string Path, long Size)> list) =>
        list.OrderByDescending(c => IsLauncherName(c.Path) ? c.Size / 10 : c.Size)
            .ThenBy(c => c.Path, StringComparer.OrdinalIgnoreCase)
            .First().Path;

    private static bool IsLauncherName(string path) =>
        Path.GetFileNameWithoutExtension(path).Contains("launch", StringComparison.OrdinalIgnoreCase);

    private static bool IsExcluded(string gameDir, string file)
    {
        var name = Path.GetFileNameWithoutExtension(file);
        if (ExcludedNameParts.Any(p => name.Contains(p, StringComparison.OrdinalIgnoreCase))) return true;

        var segments = RelativeSegments(gameDir, Path.GetDirectoryName(file)!);
        if (segments.Any(s => ExcludedDirNames.Contains(s, StringComparer.OrdinalIgnoreCase))) return true;

        // Unreal-Engine-Werkzeuge (CrashReportClient etc.) unter Engine\Binaries bzw. Engine\Plugins.
        for (var i = 0; i + 1 < segments.Count; i++)
        {
            if (segments[i].Equals("Engine", StringComparison.OrdinalIgnoreCase) &&
                (segments[i + 1].Equals("Binaries", StringComparison.OrdinalIgnoreCase) ||
                 segments[i + 1].Equals("Plugins", StringComparison.OrdinalIgnoreCase)))
                return true;
        }
        return false;
    }

    private static bool IsUnrealBinariesDir(string gameDir, string dir)
    {
        var segments = RelativeSegments(gameDir, dir);
        if (segments.Count < 2) return false;
        var platform = segments[^1];
        return segments[^2].Equals("Binaries", StringComparison.OrdinalIgnoreCase) &&
               (platform.Equals("Win64", StringComparison.OrdinalIgnoreCase) ||
                platform.Equals("WinGDK", StringComparison.OrdinalIgnoreCase)) &&
               !segments.Contains("Engine", StringComparer.OrdinalIgnoreCase);
    }

    private static List<string> RelativeSegments(string root, string dir)
    {
        var relative = Path.GetRelativePath(root, dir);
        if (relative == ".") return new List<string>();
        return relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar },
            StringSplitOptions.RemoveEmptyEntries).ToList();
    }

    private static IEnumerable<string> EnumerateFiles(string dir, string pattern)
    {
        var options = new EnumerationOptions
        {
            RecurseSubdirectories = true,
            MaxRecursionDepth = MaxDepth,
            IgnoreInaccessible = true,
            AttributesToSkip = FileAttributes.ReparsePoint,
            MatchCasing = MatchCasing.CaseInsensitive,
        };
        try { return Directory.EnumerateFiles(dir, pattern, options).ToList(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return new List<string>(); }
    }

    private static long SafeLength(string file)
    {
        try { return new FileInfo(file).Length; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return 0; }
    }
}
