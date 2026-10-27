using System.Text.Json;
using NeuralSwap.Core.Install;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.Presets;
using NeuralSwap.Core.Swapping;

namespace NeuralSwap.Core.NeuralRendering;

public sealed record NrOutcome(bool Success, string Message);

/// <summary>
/// Neural Rendering (fotorealistische Gesichter und Beleuchtung) per Klick.
/// Die eigentliche Installation übernimmt DLSS5oneclick über seine Kommando-
/// zeile; NeuralSwap lädt es, reicht die Spiel-EXE weiter, zeigt dessen
/// Fortschritt im Protokoll und merkt sich, ob ReShade vorher schon da war –
/// damit „Entfernen“ ein vorhandenes ReShade nie mitnimmt.
/// </summary>
public sealed class NeuralRenderingService
{
    public const string Kind = "neural-rendering";

    private readonly Dlss5OneClick _tool;
    private readonly string _stateRoot;

    public NeuralRenderingService(HttpClient http, IProcessRunner runner, Dlss5OneClickSource source,
        string? toolsRoot = null, string? stateRoot = null)
    {
        var appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NeuralSwap");
        _tool = new Dlss5OneClick(http, runner, source, toolsRoot ?? Path.Combine(appData, "tools"));
        _stateRoot = stateRoot ?? Path.Combine(appData, "installs");
    }

    public NrStatus GetStatus(Game game) => NrStatus.Detect(game);

    private sealed class NrState
    {
        public bool ReShadeWasPresent { get; set; }
        public DateTime InstalledAt { get; set; } = DateTime.UtcNow;
    }

    private string StatePath(Game game) =>
        Path.Combine(_stateRoot, InstallTracker.KeyFor(game.ModDir), Kind, "state.json");

    private NrState? LoadState(Game game)
    {
        try
        {
            var path = StatePath(game);
            return File.Exists(path) ? JsonSerializer.Deserialize<NrState>(File.ReadAllText(path)) : null;
        }
        catch (JsonException) { return null; }
    }

    private static string Target(Game game) => game.MainExe ?? game.InstallDir;

    /// <summary>Installiert Neural Rendering bzw. bringt ein vorhandenes Setup auf den neuesten Stand.</summary>
    public async Task<NrOutcome> InstallAsync(Game game, IProgress<string>? progress = null, CancellationToken ct = default)
    {
        var before = GetStatus(game);
        if (before.OptiScalerPresent && new InstallTracker(game.ModDir, OptiScaler.OptiScalerInstaller.Kind, _stateRoot).IsInstalled)
            return new(false, "Hier ist OptiScaler über NeuralSwap installiert. Normales OptiScaler übernimmt die DLSS-Aufrufe " +
                              "und schaltet Neural Rendering stumm – bitte zuerst über „OptiScaler entfernen“ herausnehmen.");

        // Vor der ersten Installation festhalten, ob ReShade schon da war.
        if (LoadState(game) == null && !before.InstalledByDlss5OneClick)
        {
            var path = StatePath(game);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(new NrState { ReShadeWasPresent = before.ReShadePresent }));
        }

        if (game.LimitedModSupport) FileUnlocker.TryUnlockForMods(game.ModDir);

        var result = await RunToolAsync(game, Array.Empty<string>(), progress, ct);
        if (result.ExitCode == 0)
        {
            var after = GetStatus(game);
            return new(true, $"{Summary(result.Output, "Done.")} Status: {after.Describe()}");
        }
        return new(false, "DLSS5oneclick meldet einen Fehler: " + Summary(result.Output, "error:"));
    }

    /// <summary>Liest die Protokolle des Spiels und sagt, warum Neural Rendering läuft oder nicht.</summary>
    public async Task<NrOutcome> DiagnoseAsync(Game game, IProgress<string>? progress = null, CancellationToken ct = default)
    {
        var result = await RunToolAsync(game, new[] { "--diagnose" }, progress, ct);
        return new(result.ExitCode == 0,
            result.ExitCode == 0 ? "Diagnose ohne Fehler – Details oben im Protokoll." : "Diagnose hat Probleme gefunden – siehe [FAIL]-Zeilen oben.");
    }

    /// <summary>Wechselt auf das nächste Setup der DLSS5oneclick-Liste („funktioniert nicht? nächstes probieren“).</summary>
    public async Task<NrOutcome> NextSetupAsync(Game game, IProgress<string>? progress = null, CancellationToken ct = default)
    {
        if (game.LimitedModSupport) FileUnlocker.TryUnlockForMods(game.ModDir);
        var result = await RunToolAsync(game, new[] { "--next-setup" }, progress, ct);
        return result.ExitCode == 0
            ? new(true, $"{Summary(result.Output, "Done.")} Status: {GetStatus(game).Describe()}")
            : new(false, "Nächstes Setup nicht möglich: " + Summary(result.Output, "error:"));
    }

    /// <summary>
    /// Entfernt Neural Rendering. ReShade wird nur mitentfernt, wenn es vor der
    /// Installation über NeuralSwap noch nicht da war.
    /// </summary>
    public async Task<NrOutcome> UninstallAsync(Game game, IProgress<string>? progress = null, CancellationToken ct = default)
    {
        var state = LoadState(game);
        var removeReShade = state is { ReShadeWasPresent: false };
        if (game.LimitedModSupport) FileUnlocker.TryUnlockForMods(game.ModDir);

        var result = await RunToolAsync(game, new[] { removeReShade ? "--remove-all" : "--remove" }, progress, ct);
        if (result.ExitCode != 0)
            return new(false, "Entfernen fehlgeschlagen (läuft das Spiel noch?): " + Summary(result.Output, "error:"));

        try { File.Delete(StatePath(game)); } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }

        // Hat der One-Click das NR-Modell von DLSS5oneclick getauscht, bleibt dessen Sicherung
        // übrig, nachdem DLSS5oneclick die DLL entfernt hat – sie gehört zum entfernten Setup.
        var dlssNr = Path.Combine(game.ModDir, DlssDllKind.NeuralRendering.FileName());
        var orphan = DllSwapper.BackupPath(dlssNr);
        if (!File.Exists(dlssNr) && File.Exists(orphan))
        {
            try { File.Delete(orphan); } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        return new(true, removeReShade
            ? "Neural Rendering und ReShade entfernt."
            : "Neural Rendering entfernt. ReShade bleibt, weil es schon vorher da war (oder nicht über NeuralSwap kam).");
    }

    /// <summary>
    /// Setzt bzw. entfernt [RenoDX.DLSS5] EnableHooks=1. Nur auf ausdrücklichen
    /// Wunsch: Das Add-on verlangt den Wert selbst, wenn es Streamline nicht
    /// automatisch erfasst – ohne den Schlüssel schaltet es die Hooks bei Bedarf
    /// allein ein, und =1 kann manche Spiele beim Start abstürzen lassen.
    /// </summary>
    public NrOutcome SetEnableHooks(Game game, bool enable)
    {
        var status = GetStatus(game);
        if (status.Consumer != NeuralConsumer.RenoDxDlss5)
            return new(false, "EnableHooks gehört zum renodx-dlss5-Add-on, das hier nicht installiert ist.");

        if (game.LimitedModSupport) FileUnlocker.TryUnlockForMods(game.ModDir);
        var path = Path.Combine(status.ModDir, "ReShade.ini");
        var backup = path + ".nsbak";
        try
        {
            if (File.Exists(path) && !File.Exists(backup)) File.Copy(path, backup);
            var ini = IniFile.Load(path);
            if (enable) ini.Set("RenoDX.DLSS5", "EnableHooks", "1");
            else ini.Remove("RenoDX.DLSS5", "EnableHooks");
            ini.Save(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new(false, $"ReShade.ini nicht beschreibbar: {ex.Message}");
        }

        return new(true, enable
            ? "EnableHooks=1 gesetzt – Spiel neu starten. Stürzt es danach beim Start ab, hier wieder entfernen."
            : "EnableHooks entfernt – das Add-on entscheidet wieder selbst.");
    }

    private async Task<ProcessResult> RunToolAsync(Game game, IReadOnlyList<string> flags,
        IProgress<string>? progress, CancellationToken ct)
    {
        var tool = await _tool.EnsureAsync(progress, ct);
        progress?.Report($"DLSS5oneclick {tool.Tag}: {string.Join(' ', flags.DefaultIfEmpty("Installieren/Aktualisieren"))} …");
        var result = await _tool.RunAsync(tool, Target(game), flags,
            line => { if (Dlss5OneClick.CleanLine(line) is { } text) progress?.Report("  " + text); }, ct);
        if (result.TimedOut) progress?.Report("DLSS5oneclick hat das Zeitlimit überschritten und wurde beendet.");
        return result;
    }

    /// <summary>Die aussagekräftigste Zeile der Ausgabe (z. B. „Done. In game: …“ oder „error: …“).</summary>
    public static string Summary(string output, string preferredPrefix)
    {
        var lines = output.Split('\n')
            .Select(Dlss5OneClick.CleanLine)
            .Where(l => l != null)
            .Select(l => l!)
            .ToList();
        return lines.LastOrDefault(l => l.StartsWith(preferredPrefix, StringComparison.OrdinalIgnoreCase))
               ?? lines.LastOrDefault()
               ?? "(keine Ausgabe)";
    }
}
