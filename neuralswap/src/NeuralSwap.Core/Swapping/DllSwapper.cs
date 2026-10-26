using NeuralSwap.Core.Models;
using NeuralSwap.Core.Scanning;

namespace NeuralSwap.Core.Swapping;

/// <summary>
/// Tauscht eine DLSS-DLL im Spielordner gegen eine neue Version.
/// Das Original wird einmalig als *.nsbak gesichert und kann jederzeit
/// wiederhergestellt werden; weitere Swaps überschreiben das Backup nicht.
/// </summary>
public static class DllSwapper
{
    public const string BackupSuffix = ".nsbak";

    public static string BackupPath(string dllPath) => dllPath + BackupSuffix;

    /// <summary>Ersetzt die DLL im Spiel durch <paramref name="sourceDll"/>.</summary>
    public static SwapResult Swap(InstalledDll target, string sourceDll)
    {
        if (!File.Exists(sourceDll))
            return SwapResult.Fail($"Quelldatei fehlt: {sourceDll}");
        if (!File.Exists(target.Path))
            return SwapResult.Fail($"Ziel-DLL fehlt: {target.Path}");

        var newVersion = DlssDllLocator.ReadFileVersion(sourceDll);
        var oldVersion = target.Version ?? DlssDllLocator.ReadFileVersion(target.Path);
        if (newVersion != null && newVersion == oldVersion)
            return SwapResult.Ok($"Bereits auf Version {newVersion}.", oldVersion, newVersion, skipped: true);

        try
        {
            var backup = BackupPath(target.Path);
            if (!File.Exists(backup))
                File.Copy(target.Path, backup);

            File.Copy(sourceDll, target.Path, overwrite: true);
            target.Version = DlssDllLocator.ReadFileVersion(target.Path) ?? newVersion;
            target.HasBackup = true;
            return SwapResult.Ok(
                $"{Path.GetFileName(target.Path)}: {oldVersion ?? "?"} → {target.Version ?? "?"}",
                oldVersion, target.Version);
        }
        catch (UnauthorizedAccessException ex)
        {
            return SwapResult.Fail(
                $"Kein Schreibzugriff auf {target.Path}. Spiel schließen bzw. App als Administrator starten. ({ex.Message})");
        }
        catch (IOException ex)
        {
            return SwapResult.Fail($"Dateifehler bei {target.Path}: {ex.Message}");
        }
    }

    /// <summary>Stellt die ursprüngliche DLL aus dem Backup wieder her.</summary>
    public static SwapResult Restore(InstalledDll target)
    {
        var backup = BackupPath(target.Path);
        if (!File.Exists(backup))
            return SwapResult.Fail($"Kein Backup vorhanden für {target.Path}.");

        try
        {
            File.Copy(backup, target.Path, overwrite: true);
            File.Delete(backup);
            target.Version = DlssDllLocator.ReadFileVersion(target.Path);
            target.HasBackup = false;
            return SwapResult.Ok($"Original wiederhergestellt: {Path.GetFileName(target.Path)} ({target.Version ?? "?"})",
                null, target.Version);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return SwapResult.Fail($"Wiederherstellung fehlgeschlagen: {ex.Message}");
        }
    }
}

public sealed record SwapResult(bool Success, string Message, string? OldVersion, string? NewVersion, bool Skipped)
{
    public static SwapResult Ok(string message, string? oldVersion, string? newVersion, bool skipped = false)
        => new(true, message, oldVersion, newVersion, skipped);

    public static SwapResult Fail(string message) => new(false, message, null, null, false);
}
