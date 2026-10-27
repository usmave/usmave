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

        progress?.Report("Scanne Spielordner auf allen Laufwerken …");
        TryAdd(games, () => new DriveScanner().Scan());

        foreach (var folder in ManualFolders.Where(Directory.Exists))
        {
            games.Add(new Game
            {
                Name = Path.GetFileName(Path.TrimEndingDirectorySeparator(folder)),
                InstallDir = folder,
                Platform = GamePlatform.Manual,
            });
        }

        var distinct = Merge(games);

        progress?.Report("Suche DLSS-DLLs und Spiel-EXE in den Spielordnern …");
        foreach (var game in distinct)
            Refresh(game);

        return distinct;
    }

    /// <summary>Liest DLLs, Spiel-EXE und Streamline-Nutzung eines Spiels neu ein.</summary>
    public static void Refresh(Game game)
    {
        game.Dlls.Clear();
        game.Dlls.AddRange(DlssDllLocator.Locate(game.InstallDir));
        GameExeLocator.Inspect(game);
    }

    /// <summary>
    /// Entfernt Duplikate (gleicher Ordner über mehrere Quellen) und geratene
    /// Laufwerks-Einträge, die selbst andere Spiele enthalten – etwa
    /// E:\Games\SteamLibrary, das sonst als ein „Spiel“ mit den DLLs aller
    /// darin liegenden Steam-Spiele erschiene.
    /// </summary>
    public static List<Game> Merge(IEnumerable<Game> games)
    {
        static string Key(Game g) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(g.InstallDir));

        var distinct = games
            .GroupBy(Key, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.OrderBy(x => x.AutoDetected).First())
            .ToList();

        var keys = distinct.Select(Key).ToList();
        return distinct
            .Where(g => !g.AutoDetected || !keys.Any(other =>
                other.Length > Key(g).Length &&
                other.StartsWith(Key(g) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(g => g.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    private static void TryAdd(List<Game> games, Func<IReadOnlyList<Game>> scan)
    {
        try { games.AddRange(scan()); }
        catch (Exception) { /* Eine kaputte Quelle soll den Gesamtscan nicht stoppen. */ }
    }
}
