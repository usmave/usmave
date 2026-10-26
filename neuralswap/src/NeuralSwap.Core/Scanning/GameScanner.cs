using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Scanning;

/// <summary>Fasst alle Plattform-Scanner zusammen und füllt die DLL-Liste je Spiel.</summary>
public sealed class GameScanner
{
    public IReadOnlyList<string> ManualFolders { get; }

    public GameScanner(IEnumerable<string>? manualFolders = null)
    {
        ManualFolders = (manualFolders ?? Enumerable.Empty<string>()).ToList();
    }

    public IReadOnlyList<Game> ScanAll(IProgress<string>? progress = null)
    {
        var games = new List<Game>();

        progress?.Report("Scanne Steam-Bibliotheken …");
        TryAdd(games, () => new SteamScanner().Scan());

        progress?.Report("Scanne Epic Games …");
        TryAdd(games, () => new EpicScanner().Scan());

        progress?.Report("Scanne GOG …");
        TryAdd(games, () => new GogScanner().Scan());

        progress?.Report("Scanne Xbox / Game Pass …");
        TryAdd(games, () => new XboxScanner().Scan());

        foreach (var folder in ManualFolders.Where(Directory.Exists))
        {
            games.Add(new Game
            {
                Name = Path.GetFileName(Path.TrimEndingDirectorySeparator(folder)),
                InstallDir = folder,
                Platform = GamePlatform.Manual,
            });
        }

        // Duplikate (gleicher Ordner über mehrere Quellen) entfernen.
        var distinct = games
            .GroupBy(g => Path.TrimEndingDirectorySeparator(g.InstallDir), StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .OrderBy(g => g.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        progress?.Report("Suche DLSS-DLLs in den Spielordnern …");
        foreach (var game in distinct)
        {
            game.Dlls.Clear();
            game.Dlls.AddRange(DlssDllLocator.Locate(game.InstallDir));
        }

        return distinct;
    }

    private static void TryAdd(List<Game> games, Func<IReadOnlyList<Game>> scan)
    {
        try { games.AddRange(scan()); }
        catch (Exception) { /* Eine kaputte Quelle soll den Gesamtscan nicht stoppen. */ }
    }
}
