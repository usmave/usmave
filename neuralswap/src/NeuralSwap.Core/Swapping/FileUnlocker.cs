using System.Diagnostics;

namespace NeuralSwap.Core.Swapping;

/// <summary>
/// Entsperrt Dateien von Xbox-/Game-Pass-Spielen (C:\XboxGames), die per
/// ACL gegen Änderungen geschützt sind: Besitz übernehmen (takeown) und der
/// Administratorengruppe Vollzugriff geben (icacls). Erfordert Adminrechte,
/// die die App ohnehin anfordert. Die SID S-1-5-32-544 ist die
/// Administratorengruppe – unabhängig von der Windows-Sprache.
/// </summary>
public static class FileUnlocker
{
    private const string AdminsSid = "*S-1-5-32-544";

    /// <summary>Entsperrt eine Datei samt ihrem Ordner. True bei Erfolg.</summary>
    public static bool TryUnlock(string filePath)
    {
        if (!OperatingSystem.IsWindows()) return false;

        var ok = true;
        var dir = Path.GetDirectoryName(filePath);
        if (dir != null)
        {
            // Ordner zuerst, damit auch Backup-Dateien angelegt werden können.
            Run("takeown", $"/F \"{dir}\"");
            ok &= Run("icacls", $"\"{dir}\" /grant {AdminsSid}:F");
        }

        Run("takeown", $"/F \"{filePath}\"");
        ok &= Run("icacls", $"\"{filePath}\" /grant {AdminsSid}:F");
        return ok;
    }

    private static bool Run(string fileName, string arguments)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            });
            if (process == null) return false;
            process.WaitForExit(15_000);
            return process.HasExited && process.ExitCode == 0;
        }
        catch (Exception)
        {
            return false;
        }
    }
}
