using NeuralSwap.Core.Library;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.Presets;
using NeuralSwap.Core.Swapping;

namespace NeuralSwap.Core;

/// <summary>
/// Der „One-Click": bringt bei einem Spiel (oder allen) jede gefundene
/// DLSS-DLL auf die neueste Version aus der Bibliothek und erzwingt optional
/// das bevorzugte Render-Preset.
/// </summary>
public sealed class OneClickService
{
    private readonly DllLibrary _library;
    private readonly ManifestService _manifests;

    public OneClickService(DllLibrary library, ManifestService? manifests = null)
    {
        _library = library;
        _manifests = manifests ?? new ManifestService();
    }

    /// <summary>
    /// Sorgt dafür, dass für jede im Manifest gelistete DLL die neueste Version
    /// in der Bibliothek liegt (Download nur, wenn Quellen hinterlegt sind).
    /// </summary>
    public async Task SyncLibraryAsync(VersionManifest manifest, IProgress<string>? progress = null, CancellationToken ct = default)
    {
        foreach (var dll in manifest.Dlls)
        {
            if (!DlssDllKinds.ByFileName.TryGetValue(dll.FileName, out var kind)) continue;

            var have = _library.Latest(kind);
            if (have != null && DllLibrary.ParseVersion(have.Version) >= DllLibrary.ParseVersion(dll.Version))
                continue; // Bibliothek ist aktuell.

            if (dll.Sources.Count == 0)
            {
                progress?.Report(
                    $"{dll.FileName} {dll.Version} ist verfügbar, hat aber keine Download-Quelle – bitte manuell importieren.");
                continue;
            }

            try { await _manifests.DownloadAsync(dll, _library, progress, ct); }
            catch (Exception ex) { progress?.Report($"Download übersprungen: {ex.Message}"); }
        }
    }

    public sealed record GameResult(Game Game, List<SwapResult> Swaps, PresetForcer.PresetResult? Preset);

    /// <summary>Aktualisiert alle DLSS-DLLs eines Spiels auf die neueste Bibliotheksversion.</summary>
    public GameResult UpdateGame(Game game, string? forcePreset = null, IProgress<string>? progress = null)
    {
        var swaps = new List<SwapResult>();

        foreach (var dll in game.Dlls)
        {
            var latest = _library.Latest(dll.Kind);
            if (latest == null)
            {
                swaps.Add(SwapResult.Fail(
                    $"{dll.Kind.FileName()}: keine Version in der Bibliothek – erst importieren oder herunterladen."));
                continue;
            }

            // Nie downgraden: Spiele können per Update neuere DLLs mitbringen
            // als die Bibliothek kennt.
            if (dll.Version != null &&
                DllLibrary.ParseVersion(dll.Version) >= DllLibrary.ParseVersion(latest.Version))
            {
                swaps.Add(SwapResult.Ok(
                    $"{dll.Kind.FileName()}: bereits aktuell oder neuer ({dll.Version}, Bibliothek: {latest.Version}).",
                    dll.Version, dll.Version, skipped: true));
                continue;
            }

            // Xbox/Game-Pass-Dateien sind oft ACL-geschützt → bei Bedarf entsperren.
            var result = DllSwapper.Swap(dll, latest.Path, unlockOnAccessDenied: game.LimitedModSupport);
            progress?.Report($"{game.Name}: {result.Message}");
            swaps.Add(result);
        }

        PresetForcer.PresetResult? preset = null;
        if (forcePreset != null && game.Dlls.Count > 0)
        {
            preset = PresetForcer.Force(game, forcePreset);
            progress?.Report($"{game.Name}: {preset.Message}");
        }

        return new GameResult(game, swaps, preset);
    }

    /// <summary>One-Click über alle Spiele.</summary>
    public List<GameResult> UpdateAll(IEnumerable<Game> games, string? forcePreset = null, IProgress<string>? progress = null)
    {
        var results = new List<GameResult>();
        foreach (var game in games)
        {
            if (game.Dlls.Count == 0) continue;
            if (game.LimitedModSupport)
                progress?.Report($"{game.Name}: Xbox/Game-Pass-Titel – geschützte Dateien werden bei Bedarf entsperrt.");
            results.Add(UpdateGame(game, forcePreset, progress));
        }
        return results;
    }
}
