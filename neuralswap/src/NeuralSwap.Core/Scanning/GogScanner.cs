using Microsoft.Win32;
using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Scanning;

/// <summary>Findet GOG-Galaxy-Installationen über die Registry.</summary>
public sealed class GogScanner
{
    public IReadOnlyList<Game> Scan()
    {
        var games = new List<Game>();
        if (!OperatingSystem.IsWindows()) return games;

        foreach (var hiveKey in new[]
        {
            @"SOFTWARE\WOW6432Node\GOG.com\Games",
            @"SOFTWARE\GOG.com\Games",
        })
        {
            using var key = Registry.LocalMachine.OpenSubKey(hiveKey);
            if (key == null) continue;

            foreach (var sub in key.GetSubKeyNames())
            {
                using var gameKey = key.OpenSubKey(sub);
                if (gameKey == null) continue;

                var name = gameKey.GetValue("gameName") as string;
                var path = gameKey.GetValue("path") as string;
                if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) continue;

                games.Add(new Game
                {
                    Name = string.IsNullOrWhiteSpace(name) ? sub : name,
                    InstallDir = path,
                    Platform = GamePlatform.Gog,
                });
            }
        }

        return games;
    }
}
