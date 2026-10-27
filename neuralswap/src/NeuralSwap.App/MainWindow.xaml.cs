using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using NeuralSwap.Core;
using NeuralSwap.Core.Install;
using NeuralSwap.Core.Library;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.NeuralRendering;
using NeuralSwap.Core.OptiScaler;
using NeuralSwap.Core.Presets;
using NeuralSwap.Core.Scanning;
using NeuralSwap.Core.Swapping;

namespace NeuralSwap.App;

public partial class MainWindow : Window
{
    private readonly AppSettings _settings = AppSettings.Load();
    private readonly DllLibrary _library = new();
    private readonly ManifestService _manifests = new();
    private readonly OneClickService _oneClick;
    private readonly HttpClient _http = CreateHttpClient();
    private readonly IProcessRunner _runner = new ProcessRunner();
    private readonly OptiScalerInstaller _opti;
    private NeuralRenderingService? _nr;

    private List<Game> _games = new();
    private VersionManifest? _manifest;
    private bool _busy;

    private static string LocalManifestPath => Path.Combine(AppContext.BaseDirectory, "dll-manifest.json");

    private sealed record PresetOption(PresetChoice Choice, string Label);

    private static readonly PresetOption[] PresetOptions =
        Enum.GetValues<PresetChoice>().Select(c => new PresetOption(c, PresetForcer.Label(c))).ToArray();

    public MainWindow()
    {
        InitializeComponent();
        _oneClick = new OneClickService(_library, _manifests);
        _opti = new OptiScalerInstaller(_http);

        QualityCombo.ItemsSource = QualityOptions.Select(o => o.Label).ToList();
        QualityCombo.SelectedIndex = 0;

        PresetCombo.ItemsSource = PresetOptions;
        PresetCombo.DisplayMemberPath = nameof(PresetOption.Label);
        PresetCombo.SelectedItem = PresetOptions.First(o => o.Choice == _settings.PreferredPresetChoice);
        ForcePresetCheck.IsChecked = _settings.ForcePresetOnOneClick;

        Log("NeuralSwap gestartet. Erst „Spiele scannen“, dann „One-Click“. " +
            "DLL-Versionen verwaltest du unter „DLL-Bibliothek…“.");
        if (_settings.PresetMigrated)
        {
            Log("Hinweis: Das bisher gespeicherte Preset „B“ war fürs Upscaling falsch (Preset B ist in aktuellen DLLs " +
                "entfernt) und hat nie gewirkt. Die Einstellung wurde zurückgesetzt; Presets wirken nur mit OptiScaler, " +
                "sonst in der NVIDIA App setzen.");
            _settings.Save();
        }
    }

    private static HttpClient CreateHttpClient()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("NeuralSwap/0.2");
        return http;
    }

    // ----- Hilfsklassen für die Listen -----

    private sealed record GameRow(Game Game, string Name, string Subtitle);
    private sealed record DllRow(string KindName, string Version, string Status);

    private static readonly (string Label, QualityMode Mode)[] QualityOptions =
    {
        ("Standard (Spiel entscheidet)", QualityMode.GameDefault),
        ("DLAA (native Auflösung)", QualityMode.Dlaa),
        ("Qualität (Faktor 1,5)", QualityMode.Quality),
        ("Ausgewogen (Faktor 1,7)", QualityMode.Balanced),
        ("Performance (Faktor 2,0)", QualityMode.Performance),
        ("Ultra Performance (Faktor 3,0)", QualityMode.UltraPerformance),
    };

    // ----- Protokoll -----

    private void Log(string message) => Dispatcher.Invoke(() =>
    {
        LogBox.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}\r\n");
        LogBox.ScrollToEnd();
    });

    private IProgress<string> LogProgress() => new Progress<string>(Log);

    // ----- Zustand -----

    private PresetChoice SelectedPreset => (PresetCombo.SelectedItem as PresetOption)?.Choice ?? PresetChoice.Latest;
    private PresetChoice? PresetIfForced => ForcePresetCheck.IsChecked == true ? SelectedPreset : null;

    private Game? SelectedGame => (GamesList.SelectedItem as GameRow)?.Game;

    private void SetBusy(bool busy)
    {
        _busy = busy;
        foreach (var button in new[] { ScanButton, OneClickButton, LibraryButton, AddFolderButton,
                                       UpdateGameButton, RestoreButton, PresetButton, OptiScalerButton,
                                       ApplyTweaksButton, NeuralInstallButton, NeuralDiagnoseButton,
                                       NeuralNextButton, NeuralHooksButton, NeuralRemoveButton })
            button.IsEnabled = !busy;
        Cursor = busy ? System.Windows.Input.Cursors.Wait : null;
        if (!busy) RefreshDetail();
    }

    private void SaveSettings()
    {
        _settings.PreferredPresetChoice = SelectedPreset;
        _settings.ForcePresetOnOneClick = ForcePresetCheck.IsChecked == true;
        _settings.Save();
    }

    private async Task<NeuralRenderingService> NrAsync()
    {
        _manifest ??= await _manifests.LoadAsync(_settings.ManifestUrl, LocalManifestPath);
        return _nr ??= new NeuralRenderingService(_http, _runner, _manifest.Dlss5OneClick);
    }

    // ----- Spieleliste -----

    private void RefreshGamesList()
    {
        var selected = SelectedGame;
        var filter = SearchBox.Text?.Trim() ?? string.Empty;
        var rows = _games
            .Where(g => filter.Length == 0 || g.Name.Contains(filter, StringComparison.OrdinalIgnoreCase))
            .Select(g => new GameRow(g, g.Name,
                $"{g.Platform} · {g.Dlls.Count} DLSS-DLL(s)" + (g.LimitedModSupport ? " · eingeschränkt" : "")))
            .ToList();
        GamesList.ItemsSource = rows;
        if (selected != null) GamesList.SelectedItem = rows.FirstOrDefault(r => r.Game == selected);
    }

    private void RefreshDetail()
    {
        var game = SelectedGame;
        if (game == null)
        {
            DetailPanel.Visibility = Visibility.Collapsed;
            NoSelectionText.Visibility = Visibility.Visible;
            return;
        }

        NoSelectionText.Visibility = Visibility.Collapsed;
        DetailPanel.Visibility = Visibility.Visible;
        GameTitle.Text = game.Name;
        GamePath.Text = game.MainExe ?? game.InstallDir + "  (Spiel-EXE nicht erkannt)";
        GameWarning.Visibility = game.LimitedModSupport ? Visibility.Visible : Visibility.Collapsed;

        var status = NrStatus.Detect(game);
        NrStatusText.Text = status.Describe();
        if (!_busy)
        {
            NeuralDiagnoseButton.IsEnabled = status.HasNeuralRendering;
            NeuralNextButton.IsEnabled = status.HasNeuralRendering;
            NeuralRemoveButton.IsEnabled = status.HasNeuralRendering;
            NeuralHooksButton.IsEnabled = status.Consumer == NeuralConsumer.RenoDxDlss5;
        }
        OptiScalerButton.Content = _opti.TrackerFor(game).IsInstalled ? "🧩 OptiScaler entfernen" : "🧩 OptiScaler installieren";

        DllList.ItemsSource = game.Dlls.Count == 0
            ? new List<DllRow> { new("Keine DLSS-DLLs gefunden", "–",
                "Neural Rendering geht trotzdem (dann über den Feeder); Upscaling ggf. per OptiScaler nachrüsten.") }
            : game.Dlls.Select(d =>
            {
                var latest = _library.Latest(d.Kind);
                var state = d.HasBackup ? "getauscht (Backup vorhanden)" : "original";
                if (latest != null && d.Version != null &&
                    DllLibrary.ParseVersion(latest.Version) > DllLibrary.ParseVersion(d.Version))
                    state += $" · Update auf {latest.Version} verfügbar";
                return new DllRow(d.Kind.DisplayName(), d.Version ?? "unbekannt", state);
            }).ToList();
    }

    private void GamesList_SelectionChanged(object sender, SelectionChangedEventArgs e) => RefreshDetail();

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => RefreshGamesList();

    /// <summary>Führt eine längere Aktion im Hintergrund aus und liest danach das Spiel neu ein.</summary>
    private async Task RunForGameAsync(Game game, string label, Func<IProgress<string>, Task<string>> action)
    {
        if (_busy) return;
        SetBusy(true);
        try
        {
            var progress = LogProgress();
            var message = await Task.Run(() => action(progress));
            Log($"{game.Name}: {message}");
        }
        catch (Exception ex) { Log($"{game.Name}: {label} fehlgeschlagen: {ex.Message}"); }
        finally
        {
            await Task.Run(() => GameScanner.Refresh(game));
            RefreshGamesList();
            SetBusy(false);
        }
    }

    // ----- Aktionen: Scan, One-Click, DLLs -----

    private async void ScanButton_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        SetBusy(true);
        try
        {
            var progress = LogProgress();
            var manualFolders = _settings.ManualFolders.ToList();
            _games = (await Task.Run(() => new GameScanner(manualFolders).ScanAll(progress))).ToList();
            RefreshGamesList();
            var withDlss = _games.Count(g => g.Dlls.Count > 0);
            Log($"Scan fertig: {_games.Count} Spiele gefunden, davon {withDlss} mit DLSS-DLLs.");

            // Neuere DLL-Versionen, die Spiele selbst mitbringen (z. B. per
            // offiziellem Update), automatisch in die Bibliothek übernehmen.
            var games = _games;
            var harvested = await Task.Run(() => LibraryHarvester.Harvest(games, _library, progress));
            if (harvested.Count > 0)
                Log($"{harvested.Count} neue DLL-Version(en) aus deinen Spielen geerntet – " +
                    "per One-Click jetzt in allen Spielen nutzbar.");
        }
        catch (Exception ex) { Log("Scan fehlgeschlagen: " + ex.Message); }
        finally { SetBusy(false); }
    }

    private async Task EnsureManifestAndLibraryAsync()
    {
        _manifest ??= await _manifests.LoadAsync(_settings.ManifestUrl, LocalManifestPath);
        await _oneClick.SyncLibraryAsync(_manifest, LogProgress());
    }

    private async void OneClickButton_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        if (_games.Count == 0) { Log("Bitte zuerst „Spiele scannen“."); return; }
        SetBusy(true);
        SaveSettings();
        try
        {
            await EnsureManifestAndLibraryAsync();
            var preset = PresetIfForced;
            var progress = LogProgress();
            var results = await Task.Run(() => _oneClick.UpdateAll(_games, preset, progress));
            var swapped = results.SelectMany(r => r.Swaps).Count(s => s.Success && !s.Skipped);
            var failed = results.SelectMany(r => r.Swaps).Count(s => !s.Success);
            Log($"One-Click fertig: {swapped} DLL(s) aktualisiert, {failed} Fehler.");
            RefreshGamesList();
        }
        catch (Exception ex) { Log("One-Click fehlgeschlagen: " + ex.Message); }
        finally { SetBusy(false); }
    }

    private async void UpdateGameButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;
        SaveSettings();
        var preset = PresetIfForced;
        await RunForGameAsync(game, "Aktualisierung", async progress =>
        {
            await EnsureManifestAndLibraryAsync();
            var result = _oneClick.UpdateGame(game, preset, progress);
            return $"{result.Swaps.Count(s => s.Success && !s.Skipped)} DLL(s) aktualisiert.";
        });
    }

    private void RestoreButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;
        foreach (var dll in game.Dlls.Where(d => d.HasBackup))
            Log($"{game.Name}: {DllSwapper.Restore(dll, unlockOnAccessDenied: game.LimitedModSupport).Message}");
        if (!game.Dlls.Any(d => d.HasBackup)) Log($"{game.Name}: nichts wiederherzustellen.");
        RefreshDetail();
    }

    private void SharpnessSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (SharpnessLabel != null)
            SharpnessLabel.Text = $"{e.NewValue:P0}";
    }

    private void ApplyTweaksButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;

        var mode = QualityOptions[Math.Max(0, QualityCombo.SelectedIndex)].Mode;
        double? sharpness = SharpenCheck.IsChecked == true ? SharpnessSlider.Value : null;
        Log($"{game.Name}: {QualityTweaker.Apply(game, mode, sharpness).Message}");
    }

    private void PresetButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;
        SaveSettings();
        Log($"{game.Name}: {PresetForcer.Apply(game, SelectedPreset).Message}");
    }

    // ----- Aktionen: OptiScaler -----

    private async void OptiScalerButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;

        if (_opti.TrackerFor(game).IsInstalled)
        {
            if (Ask($"OptiScaler aus „{game.Name}“ entfernen? Der Originalzustand wird wiederhergestellt.") )
                await RunForGameAsync(game, "OptiScaler entfernen", _ => Task.FromResult(_opti.Uninstall(game).Message));
            return;
        }

        if (!Ask($"OptiScaler in „{game.Name}“ installieren?\n\nLädt das neueste OptiScaler-Release von GitHub und legt es " +
                 "neben die Spiel-EXE (unter einem freien Proxy-Namen – vorhandene Dateien wie ReShade werden nie überschrieben). " +
                 "Gedacht für Spiele ohne DLSS. Nicht zusammen mit Neural Rendering verwenden. Nur Singleplayer!"))
            return;

        await RunForGameAsync(game, "OptiScaler-Installation", async progress =>
        {
            _manifest ??= await _manifests.LoadAsync(_settings.ManifestUrl, LocalManifestPath);
            var result = await _opti.InstallAsync(game, _manifest.OptiScalerRepo, _settings.OptiScalerProxy, progress);
            return result.Message;
        });
    }

    // ----- Aktionen: Neural Rendering -----

    private async void NeuralInstallButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;

        var status = NrStatus.Detect(game);
        if (!status.HasNeuralRendering &&
            !Ask($"Neural Rendering (fotorealistische Gesichter & Beleuchtung) in „{game.Name}“ installieren?\n\n" +
                 "NeuralSwap nutzt dafür DLSS5oneclick (Open Source, MIT): Es wählt das passende Setup für dieses Spiel " +
                 "selbst (ReShade + renodx-dlss5, bei Vulkan-Spielen OptiScaler-NR, bei Spielen ohne DLSS den Feeder) und " +
                 "lädt alles direkt von den Original-Projekten.\n\n" +
                 "• Das neuronale Modell läuft offiziell nur auf RTX 50.\n" +
                 "• Nur für Singleplayer-Spiele (Anti-Cheat!).\n" +
                 "• Lässt sich über „Entfernen“ wieder herausnehmen."))
            return;

        await RunForGameAsync(game, "Neural Rendering", async progress =>
            (await (await NrAsync()).InstallAsync(game, progress)).Message);
    }

    private async void NeuralDiagnoseButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;
        await RunForGameAsync(game, "Diagnose", async progress =>
            (await (await NrAsync()).DiagnoseAsync(game, progress)).Message);
    }

    private async void NeuralNextButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;
        if (!Ask("Das aktuelle Neural-Rendering-Setup herausnehmen und das nächste aus der Liste von DLSS5oneclick " +
                 "installieren (z. B. ShortFuses Add-on, eine ältere renodx-dlss5-Version oder OptiScaler-NR)?"))
            return;
        await RunForGameAsync(game, "Nächstes Setup", async progress =>
            (await (await NrAsync()).NextSetupAsync(game, progress)).Message);
    }

    private async void NeuralHooksButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;

        var current = NrStatus.Detect(game).EnableHooks?.Trim();
        bool enable;
        if (current == "1")
        {
            if (!Ask("EnableHooks=1 ist gesetzt. Wieder entfernen (z. B. wenn das Spiel seitdem beim Start abstürzt)? " +
                     "Dann entscheidet das Add-on wieder selbst."))
                return;
            enable = false;
        }
        else
        {
            if (!Ask("Zeigt das Add-on im Spiel (Pos1 → „DLSS 5 Neural Rendering“) den Hinweis " +
                     "„NR braucht die Streamline-Einstellung … Setze EnableHooks=1“?\n\n" +
                     "Nur dann EnableHooks=1 setzen – sonst schaltet das Add-on die Hooks bei Bedarf selbst ein, " +
                     "und der erzwungene Wert kann manche Spiele beim Start abstürzen lassen."))
                return;
            enable = true;
        }

        await RunForGameAsync(game, "EnableHooks", async _ => (await NrAsync()).SetEnableHooks(game, enable).Message);
    }

    private async void NeuralRemoveButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;
        if (!Ask($"Neural Rendering aus „{game.Name}“ entfernen? (Spiel vorher schließen.)"))
            return;
        await RunForGameAsync(game, "Entfernen", async progress =>
            (await (await NrAsync()).UninstallAsync(game, progress)).Message);
    }

    private bool Ask(string question) =>
        MessageBox.Show(this, question, "NeuralSwap", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes;

    // ----- Ordner & Bibliothek -----

    private void AddFolderButton_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        var dialog = new OpenFolderDialog { Title = "Spielordner auswählen" };
        if (dialog.ShowDialog(this) != true) return;

        if (!_settings.ManualFolders.Contains(dialog.FolderName, StringComparer.OrdinalIgnoreCase))
        {
            _settings.ManualFolders.Add(dialog.FolderName);
            _settings.Save();
        }
        Log($"Ordner hinzugefügt: {dialog.FolderName}");
        ScanButton_Click(sender, e);
    }

    private async void LibraryButton_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        try
        {
            _manifest ??= await _manifests.LoadAsync(_settings.ManifestUrl, LocalManifestPath);
        }
        catch (Exception ex) { Log("Manifest konnte nicht geladen werden: " + ex.Message); }

        var window = new LibraryWindow(_library, _manifests, _manifest ?? new VersionManifest(), Log) { Owner = this };
        window.ShowDialog();
        RefreshDetail();
    }
}
