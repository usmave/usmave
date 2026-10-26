using System.Diagnostics;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.Swapping;

namespace NeuralSwap.Core.Scanning;

/// <summary>Sucht in einem Spielordner nach den tauschbaren NGX-DLLs.</summary>
public static class DlssDllLocator
{
    /// <summary>
    /// Tiefenbegrenzung, damit riesige Spielordner nicht ewig gescannt
    /// werden. Unreal-Engine-Spiele (z. B. Hogwarts Legacy) liegen bei
    /// Engine\Plugins\Runtime\Nvidia\DLSS\Binaries\ThirdParty\Win64 –
    /// das sind bereits 8 Ebenen, daher großzügig 12.
    /// </summary>
    public const int MaxDepth = 12;

    public static List<InstalledDll> Locate(string gameDir)
    {
        var found = new List<InstalledDll>();
        if (!Directory.Exists(gameDir)) return found;

        var options = new EnumerationOptions
        {
            RecurseSubdirectories = true,
            MaxRecursionDepth = MaxDepth,
            IgnoreInaccessible = true,
            // Reparse-Points überspringen, sonst drohen Endlosschleifen
            // über Verzeichnis-Links.
            AttributesToSkip = FileAttributes.ReparsePoint,
        };

        IEnumerable<string> files;
        try { files = Directory.EnumerateFiles(gameDir, "nvngx_dlss*.dll", options); }
        catch (UnauthorizedAccessException) { return found; }
        catch (IOException) { return found; }

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
        return found;
    }

    public static string? ReadFileVersion(string file)
    {
        try
        {
            var info = FileVersionInfo.GetVersionInfo(file);
            if (!string.IsNullOrWhiteSpace(info.FileVersion))
                return Library.DllLibrary.NormalizeVersion(info.FileVersion);
            if (info.FileMajorPart + info.FileMinorPart + info.FileBuildPart + info.FilePrivatePart > 0)
                return $"{info.FileMajorPart}.{info.FileMinorPart}.{info.FileBuildPart}.{info.FilePrivatePart}";
        }
        catch (Exception) { /* Version ist optional */ }
        return null;
    }
}
