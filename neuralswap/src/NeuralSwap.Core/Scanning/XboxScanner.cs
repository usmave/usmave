using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Scanning;

/// <summary>
/// Findet Xbox-/Game-Pass-Installationen über die üblichen XboxGames-Ordner.
/// Viele dieser Titel sind durch UWP-Dateischutz nicht oder nur eingeschränkt
/// modbar; die App zeigt das entsprechend an.
/// </summary>
public sealed class XboxScanner
{
    public IReadOnlyList<Game> Scan()
    {
        var roots = DriveInfo.GetDrives()
            .Where(d => d.DriveType == DriveType.Fixed && d.IsReady)
            .Select(d => Path.Combine(d.RootDirectory.FullName, "XboxGames"));
        return ScanRoots(roots);
    }

    public IReadOnlyList<Game> ScanRoots(IEnumerable<string> xboxGamesRoots)
    {
        var games = new List<Game>();
        foreach (var root in xboxGamesRoots)
        {
            if (!Directory.Exists(root)) continue;
            foreach (var gameDir in Directory.EnumerateDirectories(root))
            {
                // Spieldaten liegen bei Game-Pass-Titeln unter "Content".
                var content = Path.Combine(gameDir, "Content");
                games.Add(new Game
                {
                    Name = Path.GetFileName(gameDir),
                    InstallDir = Directory.Exists(content) ? content : gameDir,
                    Platform = GamePlatform.Xbox,
                });
            }
        }
        return games;
    }
}
