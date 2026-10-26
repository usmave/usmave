using Microsoft.Win32;
using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Scanning;

/// <summary>Findet Steam-Spiele über libraryfolders.vdf und appmanifest_*.acf.</summary>
public sealed class SteamScanner
{
    /// <summary>Ermittelt den Steam-Installationspfad (Registry, sonst Standardpfade).</summary>
    public static string? FindSteamRoot()
    {
        if (OperatingSystem.IsWindows())
        {
            var path = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) as string
                    ?? Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath", null) as string;
            if (path != null && Directory.Exists(path)) return Path.GetFullPath(path);
        }

        foreach (var candidate in new[]
        {
            @"C:\Program Files (x86)\Steam",
            @"C:\Program Files\Steam",
        })
        {
            if (Directory.Exists(candidate)) return candidate;
        }
        return null;
    }

    public IReadOnlyList<Game> Scan() =>
        FindSteamRoot() is { } root ? ScanFromRoot(root) : Array.Empty<Game>();

    /// <summary>Scannt ausgehend von einem Steam-Wurzelverzeichnis (testbar ohne Registry).</summary>
    public IReadOnlyList<Game> ScanFromRoot(string steamRoot)
    {
        var games = new List<Game>();
        var libraryFoldersVdf = Path.Combine(steamRoot, "steamapps", "libraryfolders.vdf");
        if (!File.Exists(libraryFoldersVdf)) return games;

        var kv = VdfParser.Parse(File.ReadAllText(libraryFoldersVdf));

        // Alle Bibliothekspfade einsammeln: "libraryfolders/<n>/path"
        var libraries = kv
            .Where(p => p.Key.EndsWith("/path", StringComparison.OrdinalIgnoreCase))
            .Select(p => p.Value)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (libraries.Count == 0) libraries.Add(steamRoot);

        foreach (var library in libraries)
        {
            var steamApps = Path.Combine(library, "steamapps");
            if (!Directory.Exists(steamApps)) continue;

            foreach (var acf in Directory.EnumerateFiles(steamApps, "appmanifest_*.acf"))
            {
                try
                {
                    var app = VdfParser.Parse(File.ReadAllText(acf));
                    if (!app.TryGetValue("AppState/installdir", out var installDir)) continue;
                    app.TryGetValue("AppState/name", out var name);

                    var fullDir = Path.Combine(steamApps, "common", installDir);
                    if (!Directory.Exists(fullDir)) continue;

                    games.Add(new Game
                    {
                        Name = string.IsNullOrWhiteSpace(name) ? installDir : name,
                        InstallDir = fullDir,
                        Platform = GamePlatform.Steam,
                    });
                }
                catch (IOException) { /* defekte Manifeste überspringen */ }
            }
        }

        return games;
    }
}
