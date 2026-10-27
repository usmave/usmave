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
    private readonly Lazy<bool> _isRtx50;

    /// <param name="isRtx50">Nur für Tests; sonst wird die Grafikkarte über den Treiber erkannt.</param>
    public OneClickService(DllLibrary library, ManifestService? manifests = null, Func<bool>? isRtx50 = null)
    {
        _library = library;
        _manifests = manifests ?? new ManifestService();
        _isRtx50 = new Lazy<bool>(isRtx50 ?? (() => Hardware.GpuInfo.IsRtx50(Hardware.GpuInfo.NvidiaAdapterName())));
    }

    /// <summary>
    /// Sorgt dafür, dass für jede im Manifest gelistete DLL die neueste Version
    /// in der Bibliothek liegt (Download nur, wenn Quellen hinterlegt sind).
    /// </summary>
    public async Task SyncLibraryAsync(VersionManifest manifest, IProgress<string>? progress = null, CancellationToken ct = default)
    {
        var withoutSource = new List<string>();
        foreach (var dll in manifest.Dlls)
        {
            if (!DlssDllKinds.ByFileName.TryGetValue(dll.FileName, out var kind)) continue;

            var have = _library.Latest(kind);
            if (have != null && DllLibrary.ParseVersion(have.Version) >= DllLibrary.ParseVersion(dll.Version))
                continue; // Bibliothek ist aktuell.

            if (dll.Sources.Count == 0)
            {
                withoutSource.Add($"{dll.FileName} {dll.Version}");
                continue;
            }

            try { await _manifests.DownloadAsync(dll, _library, progress, ct); }
            catch (Exception ex) { progress?.Report($"Download übersprungen: {ex.Message}"); }
        }

        if (withoutSource.Count > 0)
            progress?.Report($"Laut Katalog gibt es neuere DLLs ({string.Join(", ", withoutSource)}), aber ohne Download-Quelle – " +
                             "die Scan-Ernte übernimmt sie, sobald ein Spiel sie mitbringt; sonst unter „DLL-Bibliothek…“ importieren.");
    }

    public sealed record GameResult(Game Game, List<SwapResult> Swaps, PresetForcer.PresetResult? Preset, int CleanedFiles);

    /// <summary>Aktualisiert alle DLSS-DLLs eines Spiels auf die neueste Bibliotheksversion.</summary>
    public GameResult UpdateGame(Game game, PresetChoice? forcePreset = null, IProgress<string>? progress = null)
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

            // Das von DLSS5oneclick gesetzte NR-Modell ist ein Build für alle RTX-Generationen.
            // Das offizielle (schnellere) neue Modell erzeugt das Feature nur auf RTX 50.
            if (dll.Kind == DlssDllKind.NeuralRendering && File.Exists(dll.Path + ".dlss5oneclick") && !_isRtx50.Value)
            {
                swaps.Add(SwapResult.Ok(
                    $"{dll.Kind.FileName()}: Modell von DLSS5oneclick bleibt ({dll.Version}) – das neue Modell {latest.Version} läuft nur auf RTX 50.",
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
            preset = PresetForcer.Apply(game, forcePreset.Value);
            if (preset.Applied) progress?.Report($"{game.Name}: {preset.Message}");
        }

        // Wirkungslose dlsstweaks.ini früherer NeuralSwap-Versionen wegräumen.
        var cleaned = LegacyCleanup.RemoveInertDlssTweaksIni(game);
        if (cleaned > 0) progress?.Report($"{game.Name}: alte, wirkungslose dlsstweaks.ini entfernt.");

        return new GameResult(game, swaps, preset, cleaned);
    }

    /// <summary>One-Click über alle Spiele.</summary>
    public List<GameResult> UpdateAll(IEnumerable<Game> games, PresetChoice? forcePreset = null, IProgress<string>? progress = null)
    {
        var results = new List<GameResult>();
        foreach (var game in games)
        {
            if (game.Dlls.Count == 0) continue;
            results.Add(UpdateGame(game, forcePreset, progress));
        }

        if (forcePreset != null)
        {
            var withoutLoader = results.Count(r => r.Preset is { Applied: false });
            if (withoutLoader > 0)
                progress?.Report($"Preset: {withoutLoader} Spiel(e) ohne OptiScaler – dort das Preset in der NVIDIA App setzen " +
                                 "(Grafik → Programmeinstellungen → DLSS-Override → Modell-Presets).");
        }
        return results;
    }
}
