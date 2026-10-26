using System.Security.Cryptography;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.Scanning;

namespace NeuralSwap.Core.Library;

/// <summary>
/// Lokale Ablage der verfügbaren DLSS-DLL-Versionen, aus denen die App beim
/// Swap schöpft. Struktur: &lt;root&gt;/&lt;dateiname&gt;/&lt;version&gt;/&lt;dateiname&gt;
/// Gefüllt wird sie per manuellem Import oder per Manifest-Download.
/// </summary>
public sealed class DllLibrary
{
    public string Root { get; }

    public DllLibrary(string? root = null)
    {
        Root = root ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "NeuralSwap", "library");
        Directory.CreateDirectory(Root);
    }

    public sealed record LibraryEntry(DlssDllKind Kind, string Version, string Path);

    public IReadOnlyList<LibraryEntry> List()
    {
        var entries = new List<LibraryEntry>();
        foreach (var (fileName, kind) in DlssDllKinds.ByFileName)
        {
            var kindDir = Path.Combine(Root, fileName);
            if (!Directory.Exists(kindDir)) continue;
            foreach (var versionDir in Directory.EnumerateDirectories(kindDir))
            {
                var dll = Path.Combine(versionDir, fileName);
                if (File.Exists(dll))
                    entries.Add(new LibraryEntry(kind, Path.GetFileName(versionDir), dll));
            }
        }
        return entries;
    }

    /// <summary>Neueste vorhandene Version einer DLL-Art (numerisch sortiert).</summary>
    public LibraryEntry? Latest(DlssDllKind kind) =>
        List()
            .Where(e => e.Kind == kind)
            .OrderByDescending(e => ParseVersion(e.Version))
            .FirstOrDefault();

    /// <summary>
    /// Importiert eine DLL-Datei in die Bibliothek. Der Dateiname muss einer
    /// bekannten NGX-DLL entsprechen; die Version wird aus der Datei gelesen.
    /// </summary>
    public LibraryEntry Import(string sourceFile, string? expectedSha256 = null)
    {
        var fileName = Path.GetFileName(sourceFile);
        if (!DlssDllKinds.ByFileName.TryGetValue(fileName, out var kind))
            throw new ArgumentException(
                $"\"{fileName}\" ist keine bekannte DLSS-DLL (erwartet: {string.Join(", ", DlssDllKinds.ByFileName.Keys)}).");

        if (expectedSha256 != null)
        {
            var actual = Sha256Of(sourceFile);
            if (!actual.Equals(expectedSha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    $"SHA-256 stimmt nicht überein (erwartet {expectedSha256}, erhalten {actual}). Datei wird nicht übernommen.");
        }

        var version = DlssDllLocator.ReadFileVersion(sourceFile) ?? "unbekannt";
        var targetDir = Path.Combine(Root, fileName, Sanitize(version));
        Directory.CreateDirectory(targetDir);
        var target = Path.Combine(targetDir, fileName);
        File.Copy(sourceFile, target, overwrite: true);
        return new LibraryEntry(kind, version, target);
    }

    public static string Sha256Of(string file)
    {
        using var stream = File.OpenRead(file);
        return Convert.ToHexString(SHA256.HashData(stream));
    }

    public static Version ParseVersion(string version)
    {
        var numeric = new string(version.TakeWhile(c => char.IsDigit(c) || c == '.').ToArray()).Trim('.');
        return Version.TryParse(numeric.Contains('.') ? numeric : numeric + ".0", out var v) ? v : new Version(0, 0);
    }

    private static string Sanitize(string s)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
        return s;
    }
}
