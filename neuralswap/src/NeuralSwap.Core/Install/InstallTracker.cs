using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NeuralSwap.Core.Install;

/// <summary>Größe und Änderungszeit einer Datei zum Zeitpunkt eines Schnappschusses.</summary>
public readonly record struct FileStamp(long Length, DateTime LastWriteUtc);

/// <summary>
/// Schnappschuss eines Spielordners: alle Dateien der obersten Ebene plus der
/// angegebenen Unterordner (rekursiv). Grundlage für das Rückgängigmachen
/// jeder Installation – auch wenn fremde Installer (ReShade-Setup, Feeder-
/// Skript) die Dateien schreiben.
/// </summary>
public sealed class DirectorySnapshot
{
    public required string Root { get; init; }
    public Dictionary<string, FileStamp> Files { get; } = new(StringComparer.OrdinalIgnoreCase);
    public HashSet<string> Dirs { get; } = new(StringComparer.OrdinalIgnoreCase);

    public static DirectorySnapshot Capture(string root, IEnumerable<string> recursiveDirs)
    {
        var snapshot = new DirectorySnapshot { Root = root };
        if (!Directory.Exists(root)) return snapshot;

        foreach (var file in Directory.EnumerateFiles(root))
            snapshot.Add(file);

        foreach (var dir in Directory.EnumerateDirectories(root))
            snapshot.Dirs.Add(Path.GetFileName(dir));

        var options = new EnumerationOptions
        {
            RecurseSubdirectories = true,
            IgnoreInaccessible = true,
            AttributesToSkip = FileAttributes.ReparsePoint,
        };
        foreach (var name in recursiveDirs.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var dir = Path.Combine(root, name);
            if (!Directory.Exists(dir)) continue;
            foreach (var sub in Directory.EnumerateDirectories(dir, "*", options))
                snapshot.Dirs.Add(Path.GetRelativePath(root, sub));
            foreach (var file in Directory.EnumerateFiles(dir, "*", options))
                snapshot.Add(file);
        }
        return snapshot;
    }

    private void Add(string file)
    {
        try
        {
            var info = new FileInfo(file);
            Files[Path.GetRelativePath(Root, file)] = new FileStamp(info.Length, info.LastWriteTimeUtc);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}

/// <summary>Was eine Installation verändert hat – persistiert für das spätere Entfernen.</summary>
public sealed class InstallRecord
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("modDir")] public string ModDir { get; set; } = "";
    [JsonPropertyName("route")] public string? Route { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    [JsonPropertyName("createdFiles")] public List<string> CreatedFiles { get; set; } = new();
    [JsonPropertyName("createdDirs")] public List<string> CreatedDirs { get; set; } = new();

    /// <summary>Geänderte oder gelöschte Dateien → Pfad ihrer Sicherung.</summary>
    [JsonPropertyName("restoreFiles")] public Dictionary<string, string> RestoreFiles { get; set; } = new();

    /// <summary>Geänderte Dateien ohne Sicherung (zu groß o. ä.) – nur zur Info.</summary>
    [JsonPropertyName("unrestorable")] public List<string> Unrestorable { get; set; } = new();

    /// <summary>ReShade wurde von dieser Installation erst eingerichtet.</summary>
    [JsonPropertyName("reshadeInstalledByUs")] public bool ReShadeInstalledByUs { get; set; }

    /// <summary>EXE, auf die ReShade eingerichtet wurde (für dessen Deinstallation).</summary>
    [JsonPropertyName("gameExe")] public string? GameExe { get; set; }

    [JsonIgnore] public bool HasChanges => CreatedFiles.Count + CreatedDirs.Count + RestoreFiles.Count > 0;
}

/// <summary>
/// Verfolgt eine Installation in einem Spielordner per Schnappschuss-Vergleich
/// und kann sie vollständig rückgängig machen. Zustand und Sicherungen liegen
/// unter %LOCALAPPDATA%\NeuralSwap\installs – nicht im Spielordner.
/// </summary>
public sealed class InstallTracker
{
    /// <summary>Dateien bis zu dieser Größe werden vor der Installation gesichert.</summary>
    public const long MaxBackupFileSize = 64L * 1024 * 1024;

    private static readonly string[] BackupExtensions =
        { ".ini", ".cfg", ".json", ".txt", ".toml", ".dll", ".asi", ".addon64", ".addon32", ".fx", ".fxh", ".png" };

    private readonly string _stateDir;

    public string ModDir { get; }
    public string Kind { get; }
    public string RecordPath => Path.Combine(_stateDir, "record.json");
    private string BackupDir => Path.Combine(_stateDir, "backup");

    public InstallTracker(string modDir, string kind, string? stateRoot = null)
    {
        ModDir = modDir;
        Kind = kind;
        stateRoot ??= Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NeuralSwap", "installs");
        _stateDir = Path.Combine(stateRoot, KeyFor(modDir), kind);
    }

    public static string KeyFor(string dir)
    {
        var normalized = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir)).ToLowerInvariant();
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)))[..16].ToLowerInvariant();
    }

    public bool IsInstalled => File.Exists(RecordPath);

    public InstallRecord? Load()
    {
        try
        {
            return File.Exists(RecordPath)
                ? JsonSerializer.Deserialize<InstallRecord>(File.ReadAllText(RecordPath))
                : null;
        }
        catch (JsonException) { return null; }
    }

    public sealed class Session
    {
        internal Session(DirectorySnapshot before, Dictionary<string, string> backups, string[] recursiveDirs)
        {
            Before = before;
            Backups = backups;
            RecursiveDirs = recursiveDirs;
        }

        public DirectorySnapshot Before { get; }
        public Dictionary<string, string> Backups { get; }
        public string[] RecursiveDirs { get; }
    }

    /// <summary>Schnappschuss + Sicherungen anlegen, bevor irgendetwas verändert wird.</summary>
    public Session Begin(params string[] recursiveDirs)
    {
        if (IsInstalled)
            throw new InvalidOperationException("Es existiert bereits eine Installation, die zuerst entfernt werden muss.");

        if (Directory.Exists(BackupDir)) Directory.Delete(BackupDir, recursive: true);
        Directory.CreateDirectory(BackupDir);

        var before = DirectorySnapshot.Capture(ModDir, recursiveDirs);
        var backups = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (rel, stamp) in before.Files)
        {
            var isTopLevel = !rel.Contains(Path.DirectorySeparatorChar);
            var ext = Path.GetExtension(rel);
            if (stamp.Length > MaxBackupFileSize) continue;
            if (isTopLevel && !BackupExtensions.Contains(ext, StringComparer.OrdinalIgnoreCase)) continue;

            var target = Path.Combine(BackupDir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(Path.Combine(ModDir, rel), target, overwrite: true);
            backups[rel] = target;
        }
        return new Session(before, backups, recursiveDirs);
    }

    /// <summary>Vergleicht den Ordner mit dem Schnappschuss und ermittelt alle Änderungen.</summary>
    public InstallRecord Diff(Session session)
    {
        // Neu entstandene Ordner der obersten Ebene vollständig erfassen.
        var newTopDirs = Directory.Exists(ModDir)
            ? Directory.EnumerateDirectories(ModDir).Select(Path.GetFileName)
                .Where(d => d != null && !session.Before.Dirs.Contains(d)).Select(d => d!).ToList()
            : new List<string>();
        var after = DirectorySnapshot.Capture(ModDir, session.RecursiveDirs.Concat(newTopDirs));

        var record = new InstallRecord { Kind = Kind, ModDir = ModDir };

        foreach (var (rel, stamp) in after.Files)
        {
            if (!session.Before.Files.TryGetValue(rel, out var old))
            {
                record.CreatedFiles.Add(rel);
            }
            else if (old != stamp || ContentDiffers(rel, session))
            {
                if (session.Backups.TryGetValue(rel, out var backup)) record.RestoreFiles[rel] = backup;
                else record.Unrestorable.Add(rel);
            }
        }

        foreach (var rel in session.Before.Files.Keys.Where(k => !after.Files.ContainsKey(k)))
        {
            if (session.Backups.TryGetValue(rel, out var backup)) record.RestoreFiles[rel] = backup;
            else record.Unrestorable.Add(rel);
        }

        record.CreatedDirs.AddRange(after.Dirs.Where(d => !session.Before.Dirs.Contains(d)));
        return record;
    }

    private bool ContentDiffers(string rel, Session session)
    {
        if (!session.Backups.TryGetValue(rel, out var backup)) return false;
        try
        {
            var current = Path.Combine(ModDir, rel);
            var a = new FileInfo(current);
            var b = new FileInfo(backup);
            if (a.Length != b.Length) return true;
            return !File.ReadAllBytes(current).AsSpan().SequenceEqual(File.ReadAllBytes(backup));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return true; }
    }

    /// <summary>Speichert die Installation, damit sie später entfernt werden kann.</summary>
    public void Save(InstallRecord record)
    {
        Directory.CreateDirectory(_stateDir);
        File.WriteAllText(RecordPath, JsonSerializer.Serialize(record, new JsonSerializerOptions { WriteIndented = true }));
    }

    /// <summary>
    /// Macht eine Installation rückgängig: erstellte Dateien löschen, gesicherte
    /// Originale zurückspielen, eigene (leere) Ordner entfernen. Dateien, die der
    /// Nutzer später selbst in diese Ordner gelegt hat, bleiben erhalten.
    /// </summary>
    public List<string> Undo(InstallRecord record)
    {
        var problems = new List<string>();

        foreach (var rel in record.CreatedFiles)
        {
            var path = Path.Combine(ModDir, rel);
            try { if (File.Exists(path)) File.Delete(path); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { problems.Add($"{rel}: {ex.Message}"); }
        }

        foreach (var (rel, backup) in record.RestoreFiles)
        {
            var path = Path.Combine(ModDir, rel);
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.Copy(backup, path, overwrite: true);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { problems.Add($"{rel}: {ex.Message}"); }
        }

        foreach (var rel in record.CreatedDirs.OrderByDescending(d => d.Length))
        {
            var path = Path.Combine(ModDir, rel);
            try
            {
                if (Directory.Exists(path) && !Directory.EnumerateFileSystemEntries(path).Any())
                    Directory.Delete(path);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }

        if (problems.Count == 0)
        {
            try { if (Directory.Exists(_stateDir)) Directory.Delete(_stateDir, recursive: true); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        return problems;
    }

    /// <summary>Verwirft Schnappschuss-Sicherungen nach einem Abbruch ohne Änderungen.</summary>
    public void Discard()
    {
        if (IsInstalled) return;
        try { if (Directory.Exists(_stateDir)) Directory.Delete(_stateDir, recursive: true); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}
