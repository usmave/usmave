using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Scanning;

/// <summary>
/// Findet Spiele, die ohne Launcher-Metadaten in typischen Spielordnern auf
/// beliebigen Laufwerken liegen (z. B. E:\Games, E:\Spiele, D:\Epic Games).
/// Jeder direkte Unterordner eines solchen Ordners gilt als Spielkandidat.
/// Steam-Bibliotheken und XboxGames werden von den eigenen Scannern
/// abgedeckt und hier ausgelassen.
/// </summary>
public sealed class DriveScanner
{
    public static readonly string[] CommonFolderNames =
    {
        "Games",
        "Spiele",
        "Epic Games",
        "GOG Games",
        Path.Combine("GOG Galaxy", "Games"),
        Path.Combine("Program Files", "Epic Games"),
        Path.Combine("Program Files (x86)", "GOG Galaxy", "Games"),
    };

    /// <summary>Ordnernamen, die keine Spiele sind (Launcher, Redistributables …).</summary>
    private static readonly HashSet<string> IgnoredNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "Launcher", "Redist", "DirectXRedist", "CommonRedist", "_CommonRedist", "Tools",
    };

    public IReadOnlyList<Game> Scan()
    {
        var roots = DriveInfo.GetDrives()
            .Where(d => d.DriveType == DriveType.Fixed && d.IsReady)
            .Select(d => d.RootDirectory.FullName);
        return ScanRoots(roots);
    }

    public IReadOnlyList<Game> ScanRoots(IEnumerable<string> driveRoots)
    {
        var games = new List<Game>();
        foreach (var root in driveRoots)
        {
            foreach (var folderName in CommonFolderNames)
            {
                var libraryDir = Path.Combine(root, folderName);
                if (!Directory.Exists(libraryDir)) continue;

                IEnumerable<string> subDirs;
                try { subDirs = Directory.EnumerateDirectories(libraryDir); }
                catch (UnauthorizedAccessException) { continue; }
                catch (IOException) { continue; }

                foreach (var gameDir in subDirs)
                {
                    var name = Path.GetFileName(gameDir);
                    if (IgnoredNames.Contains(name)) continue;
                    // Steam-Bibliotheken (z. B. E:\Games\SteamLibrary) deckt der Steam-Scanner ab.
                    if (Directory.Exists(Path.Combine(gameDir, "steamapps"))) continue;
                    games.Add(new Game
                    {
                        Name = name,
                        InstallDir = gameDir,
                        Platform = GamePlatform.Manual,
                        AutoDetected = true,
                    });
                }
            }
        }
        return games;
    }
}
