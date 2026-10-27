using NeuralSwap.Core.Install;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.NeuralRendering;
using NeuralSwap.Core.Swapping;
using SharpCompress.Archives;

namespace NeuralSwap.Core.OptiScaler;

/// <summary>
/// Installiert OptiScaler (https://github.com/optiscaler/OptiScaler) neben die
/// Spiel-EXE – für Spiele ohne natives DLSS. Die OptiScaler.dll wird, wie in der
/// OptiScaler-Anleitung, unter einem freien Proxy-Namen abgelegt; belegte Namen
/// (z. B. ReShades dxgi.dll) werden nie überschrieben. Jede Installation wird per
/// Schnappschuss erfasst und lässt sich vollständig entfernen.
/// </summary>
public sealed class OptiScalerInstaller
{
    public const string Kind = "optiscaler";

    /// <summary>Von OptiScaler unterstützte Proxy-Namen (OptiScaler.asi nur mit ASI-Loader).</summary>
    public static readonly string[] ProxyNames =
        { "dxgi.dll", "winmm.dll", "version.dll", "dbghelp.dll", "d3d12.dll", "wininet.dll", "winhttp.dll" };

    private readonly GitHubReleases _github;
    private readonly string _cacheDir;
    private readonly string? _stateRoot;

    public OptiScalerInstaller(HttpClient http, string? cacheRoot = null, string? stateRoot = null)
    {
        _github = new GitHubReleases(http);
        cacheRoot ??= Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NeuralSwap", "cache");
        _cacheDir = Path.Combine(cacheRoot, "optiscaler");
        _stateRoot = stateRoot;
    }

    public sealed record InstallResult(bool Success, string Message);

    public InstallTracker TrackerFor(Game game) => new(game.ModDir, Kind, _stateRoot);

    /// <summary>Erster freier Proxy-Name – bevorzugt der gewünschte.</summary>
    public static string? ChooseProxy(string modDir, string preferred)
    {
        var order = new[] { preferred }.Concat(ProxyNames).Distinct(StringComparer.OrdinalIgnoreCase);
        return order.FirstOrDefault(name =>
            ProxyNames.Contains(name, StringComparer.OrdinalIgnoreCase) && !File.Exists(Path.Combine(modDir, name)));
    }

    /// <summary>Ordner im Archiv, der OptiScaler.dll enthält ("" = Wurzel).</summary>
    public static string? FindArchiveRoot(IEnumerable<string> entryKeys)
    {
        foreach (var key in entryKeys)
        {
            var normalized = key.Replace('\\', '/');
            var name = normalized[(normalized.LastIndexOf('/') + 1)..];
            if (name.Equals("OptiScaler.dll", StringComparison.OrdinalIgnoreCase))
                return normalized[..(normalized.Length - name.Length)];
        }
        return null;
    }

    public async Task<InstallResult> InstallAsync(Game game, string repo, string preferredProxy,
        IProgress<string>? progress = null, CancellationToken ct = default)
    {
        var modDir = game.ModDir;
        var tracker = TrackerFor(game);
        if (tracker.IsInstalled)
            return new(false, "OptiScaler ist bereits über NeuralSwap installiert.");
        if (NrStatus.HasOptiScaler(modDir))
            return new(false, "OptiScaler ist in diesem Spiel bereits vorhanden.");

        var nr = NrStatus.Detect(game);
        if (nr.HasNeuralRendering)
            return new(false, "In diesem Spiel ist Neural Rendering installiert. Normales OptiScaler übernimmt die " +
                              "DLSS-Aufrufe und schaltet Neural Rendering damit stumm – deshalb wird es hier nicht installiert.");

        var proxy = ChooseProxy(modDir, preferredProxy);
        if (proxy == null)
            return new(false, "Alle Proxy-Namen sind im Spielordner belegt – OptiScaler kann nicht sicher installiert werden.");

        string archivePath;
        string tag;
        try
        {
            progress?.Report($"Suche neuestes OptiScaler-Release ({repo}) …");
            var releases = await _github.GetReleasesAsync(repo, maxPages: 1, ct);
            var release = GitHubReleases.PickLatest(releases.Where(r => !r.Prerelease), ".*", IsArchive)
                          ?? GitHubReleases.PickLatest(releases, ".*", IsArchive)
                          ?? throw new InvalidOperationException("Kein OptiScaler-Release mit Archiv gefunden.");
            var asset = release.Assets.First(IsArchive);
            tag = release.TagName;
            archivePath = Path.Combine(_cacheDir, tag, asset.Name);
            if (!File.Exists(archivePath))
            {
                progress?.Report($"Lade {asset.Name} ({tag}) …");
                await _github.DownloadAsync(asset.Url, archivePath, asset.Digest, ct);
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            return new(false, $"Download fehlgeschlagen: {ex.Message}");
        }

        if (game.LimitedModSupport) FileUnlocker.TryUnlockForMods(modDir);

        InstallTracker.Session session;
        try { session = tracker.Begin(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            tracker.Discard();
            return new(false, $"Spielordner nicht lesbar/sicherbar ({ex.Message}) – es wurde nichts verändert.");
        }

        try
        {
            progress?.Report($"Entpacke OptiScaler {tag} nach {modDir} (Proxy: {proxy}) …");
            ExtractInto(archivePath, modDir, proxy);

            var record = tracker.Diff(session);
            record.Route = proxy;
            tracker.Save(record);
            return new(true, $"OptiScaler {tag} installiert (als {proxy}). Im Spiel öffnet die Einfg-Taste das OptiScaler-Menü.");
        }
        catch (Exception ex)
        {
            var problems = tracker.Undo(tracker.Diff(session));
            tracker.Discard();
            return new(false, $"Installation abgebrochen: {ex.Message}" +
                              (problems.Count == 0 ? " Alle Änderungen wurden zurückgenommen." : " Rest: " + string.Join("; ", problems)));
        }
    }

    /// <summary>
    /// Entpackt den OptiScaler-Ordner des Archivs (egal ob in der Wurzel oder
    /// einem Unterordner) in den Mod-Ordner; OptiScaler.dll wird zum Proxy.
    /// </summary>
    public static void ExtractInto(string archivePath, string modDir, string proxyName)
    {
        using var archive = ArchiveFactory.OpenArchive(archivePath, new SharpCompress.Readers.ReaderOptions());
        var root = FindArchiveRoot(archive.Entries.Where(e => !e.IsDirectory).Select(e => e.Key ?? ""))
                   ?? throw new InvalidOperationException("Das Archiv enthält keine OptiScaler.dll.");

        var fullModDir = Path.GetFullPath(modDir) + Path.DirectorySeparatorChar;

        string? TargetFor(string? entryKey)
        {
            if (entryKey == null) return null;
            var key = entryKey.Replace('\\', '/');
            if (!key.StartsWith(root, StringComparison.OrdinalIgnoreCase)) return null;
            var relative = key[root.Length..];
            if (relative.Equals("OptiScaler.dll", StringComparison.OrdinalIgnoreCase)) relative = proxyName;

            var target = Path.GetFullPath(Path.Combine(modDir, relative.Replace('/', Path.DirectorySeparatorChar)));
            if (!target.StartsWith(fullModDir, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"Unsicherer Pfad im Archiv: {entryKey}");
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            return target;
        }

        // 7z/„solide“ Archive nur sequenziell (sonst wird pro Datei neu entpackt), Zip pro Eintrag.
        if (archive.IsSolid || archive.Type == SharpCompress.Common.ArchiveType.SevenZip)
        {
            using var reader = archive.ExtractAllEntries();
            while (reader.MoveToNextEntry())
            {
                if (reader.Entry.IsDirectory || TargetFor(reader.Entry.Key) is not { } target) continue;
                using var output = File.Create(target);
                reader.WriteEntryTo(output);
            }
        }
        else
        {
            foreach (var entry in archive.Entries.Where(e => !e.IsDirectory))
            {
                if (TargetFor(entry.Key) is not { } target) continue;
                using var input = entry.OpenEntryStream();
                using var output = File.Create(target);
                input.CopyTo(output);
            }
        }
    }

    public InstallResult Uninstall(Game game)
    {
        var tracker = TrackerFor(game);
        var record = tracker.Load();
        if (record == null) return new(false, "Keine OptiScaler-Installation von NeuralSwap gefunden.");
        if (game.LimitedModSupport) FileUnlocker.TryUnlockForMods(game.ModDir);
        var problems = tracker.Undo(record);
        return problems.Count == 0
            ? new(true, "OptiScaler entfernt, Originalzustand wiederhergestellt.")
            : new(false, "Teilweise entfernt: " + string.Join("; ", problems));
    }

    private static bool IsArchive(GitHubAsset a) =>
        a.Name.EndsWith(".7z", StringComparison.OrdinalIgnoreCase) || a.Name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
}
