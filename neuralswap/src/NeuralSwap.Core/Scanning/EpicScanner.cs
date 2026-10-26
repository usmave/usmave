using System.Text.Json;
using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Scanning;

/// <summary>Findet Epic-Games-Installationen über die Launcher-Manifeste (*.item).</summary>
public sealed class EpicScanner
{
    public static string DefaultManifestDir =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "Epic", "EpicGamesLauncher", "Data", "Manifests");

    public IReadOnlyList<Game> Scan() => ScanManifestDir(DefaultManifestDir);

    public IReadOnlyList<Game> ScanManifestDir(string manifestDir)
    {
        var games = new List<Game>();
        if (!Directory.Exists(manifestDir)) return games;

        foreach (var item in Directory.EnumerateFiles(manifestDir, "*.item"))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(item));
                var root = doc.RootElement;
                var name = root.TryGetProperty("DisplayName", out var n) ? n.GetString() : null;
                var dir = root.TryGetProperty("InstallLocation", out var d) ? d.GetString() : null;
                if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(dir)) continue;
                if (!Directory.Exists(dir)) continue;

                games.Add(new Game { Name = name, InstallDir = dir, Platform = GamePlatform.Epic });
            }
            catch (JsonException) { /* defekte Manifeste überspringen */ }
            catch (IOException) { }
        }

        return games;
    }
}
