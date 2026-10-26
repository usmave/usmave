using System.Diagnostics;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.Swapping;

namespace NeuralSwap.Core.Scanning;

/// <summary>Sucht in einem Spielordner nach den tauschbaren NGX-DLLs.</summary>
public static class DlssDllLocator
{
    /// <summary>Tiefenbegrenzung, damit riesige Spielordner nicht ewig gescannt werden.</summary>
    public const int MaxDepth = 6;

    public static List<InstalledDll> Locate(string gameDir)
    {
        var found = new List<InstalledDll>();
        if (!Directory.Exists(gameDir)) return found;
        Walk(gameDir, 0, found);
        return found;
    }

    private static void Walk(string dir, int depth, List<InstalledDll> found)
    {
        if (depth > MaxDepth) return;

        IEnumerable<string> files;
        try { files = Directory.EnumerateFiles(dir, "nvngx_dlss*.dll"); }
        catch (UnauthorizedAccessException) { return; }
        catch (IOException) { return; }

        foreach (var file in files)
        {
            if (!DlssDllKinds.ByFileName.TryGetValue(Path.GetFileName(file), out var kind)) continue;
            found.Add(new InstalledDll
            {
                Kind = kind,
                Path = file,
                Version = ReadFileVersion(file),
                HasBackup = File.Exists(DllSwapper.BackupPath(file)),
            });
        }

        IEnumerable<string> subDirs;
        try { subDirs = Directory.EnumerateDirectories(dir); }
        catch (UnauthorizedAccessException) { return; }
        catch (IOException) { return; }

        foreach (var sub in subDirs)
            Walk(sub, depth + 1, found);
    }

    public static string? ReadFileVersion(string file)
    {
        try
        {
            var info = FileVersionInfo.GetVersionInfo(file);
            if (!string.IsNullOrWhiteSpace(info.FileVersion)) return info.FileVersion;
            if (info.FileMajorPart + info.FileMinorPart + info.FileBuildPart + info.FilePrivatePart > 0)
                return $"{info.FileMajorPart}.{info.FileMinorPart}.{info.FileBuildPart}.{info.FilePrivatePart}";
        }
        catch (Exception) { /* Version ist optional */ }
        return null;
    }
}
