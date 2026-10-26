using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Library;

/// <summary>
/// „Erntet" DLSS-DLLs aus installierten Spielen: Bringt ein Spiel (z. B.
/// per offiziellem Update wie Metro Redux Next-Gen) eine neuere Version mit,
/// als die Bibliothek kennt, wird sie automatisch importiert – die legalste
/// Quelle, die es gibt. Getauschte DLLs (mit Backup) stammen ohnehin aus der
/// Bibliothek und werden übersprungen.
/// </summary>
public static class LibraryHarvester
{
    public static List<DllLibrary.LibraryEntry> Harvest(
        IEnumerable<Game> games, DllLibrary library, IProgress<string>? progress = null)
    {
        var imported = new List<DllLibrary.LibraryEntry>();

        foreach (var game in games)
        {
            foreach (var dll in game.Dlls)
            {
                if (dll.Version == null || dll.HasBackup) continue;

                var known = library.Latest(dll.Kind);
                if (known != null &&
                    DllLibrary.ParseVersion(known.Version) >= DllLibrary.ParseVersion(dll.Version))
                    continue;

                try
                {
                    var entry = library.Import(dll.Path);
                    imported.Add(entry);
                    progress?.Report(
                        $"Neue Version aus „{game.Name}“ in die Bibliothek übernommen: " +
                        $"{dll.Kind.DisplayName()} {entry.Version}");
                }
                catch (Exception ex)
                {
                    progress?.Report($"Import aus „{game.Name}“ fehlgeschlagen: {ex.Message}");
                }
            }
        }

        return imported;
    }
}
