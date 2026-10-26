using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using NeuralSwap.Core;
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

    private List<Game> _games = new();
    private VersionManifest? _manifest;
    private bool _busy;

    private static string LocalManifestPath => Path.Combine(AppContext.BaseDirectory, "dll-manifest.json");

    public MainWindow()
    {
        InitializeComponent();
        _oneClick = new OneClickService(_library, _manifests);

        QualityCombo.ItemsSource = QualityOptions.Select(o => o.Label).ToList();
        QualityCombo.SelectedIndex = 0;

        PresetCombo.ItemsSource = PresetForcer.KnownPresets;
        PresetCombo.SelectedItem = PresetForcer.KnownPresets.Contains(_settings.PreferredPreset)
            ? _settings.PreferredPreset : "B";
        ForcePresetCheck.IsChecked = _settings.ForcePresetOnOneClick;

        Log("NeuralSwap gestartet. Erst „Spiele scannen“, dann „One-Click“. " +
            "DLL-Versionen verwaltest du unter „DLL-Bibliothek…“.");
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

    private string SelectedPreset => PresetCombo.SelectedItem as string ?? "B";
    private string? PresetIfForced => ForcePresetCheck.IsChecked == true ? SelectedPreset : null;

    private Game? SelectedGame => (GamesList.SelectedItem as GameRow)?.Game;

    private void SetBusy(bool busy)
    {
        _busy = busy;
        foreach (var button in new[] { ScanButton, OneClickButton, LibraryButton, AddFolderButton,
                                       UpdateGameButton, RestoreButton, PresetButton, OptiScalerButton,
                                       ApplyTweaksButton, NeuralButton })
            button.IsEnabled = !busy;
        Cursor = busy ? System.Windows.Input.Cursors.Wait : null;
    }

    private void SaveSettings()
    {
        _settings.PreferredPreset = SelectedPreset;
        _settings.ForcePresetOnOneClick = ForcePresetCheck.IsChecked == true;
        _settings.Save();
    }

    // ----- Spieleliste -----

    private void RefreshGamesList()
    {
        var filter = SearchBox.Text?.Trim() ?? string.Empty;
        var rows = _games
            .Where(g => filter.Length == 0 || g.Name.Contains(filter, StringComparison.OrdinalIgnoreCase))
            .Select(g => new GameRow(g, g.Name,
                $"{g.Platform} · {g.Dlls.Count} DLSS-DLL(s)" + (g.LimitedModSupport ? " · eingeschränkt" : "")))
            .ToList();
        GamesList.ItemsSource = rows;
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
        GamePath.Text = game.InstallDir;
        GameWarning.Visibility = game.LimitedModSupport ? Visibility.Visible : Visibility.Collapsed;

        DllList.ItemsSource = game.Dlls.Count == 0
            ? new List<DllRow> { new("Keine DLSS-DLLs gefunden", "–",
                "Über „OptiScaler installieren“ lässt sich DLSS ggf. trotzdem nachrüsten.") }
            : game.Dlls.Select(d =>
            {
                var latest = _library.Latest(d.Kind);
                var status = d.HasBackup ? "getauscht (Backup vorhanden)" : "original";
                if (latest != null && d.Version != null &&
                    DllLibrary.ParseVersion(latest.Version) > DllLibrary.ParseVersion(d.Version))
                    status += $" · Update auf {latest.Version} verfügbar";
                return new DllRow(d.Kind.DisplayName(), d.Version ?? "unbekannt", status);
            }).ToList();
    }

    private void GamesList_SelectionChanged(object sender, SelectionChangedEventArgs e) => RefreshDetail();

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => RefreshGamesList();

    // ----- Aktionen -----

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
            RefreshDetail();
            var withDlss = _games.Count(g => g.Dlls.Count > 0);
            Log($"Scan fertig: {_games.Count} Spiele gefunden, davon {withDlss} mit DLSS-DLLs.");

            // Neuere DLL-Versionen, die Spiele selbst mitbringen (z. B. per
            // offiziellem Update), automatisch in die Bibliothek übernehmen.
            var games = _games;
            var harvested = await Task.Run(() => LibraryHarvester.Harvest(games, _library, progress));
            if (harvested.Count > 0)
            {
                Log($"{harvested.Count} neue DLL-Version(en) aus deinen Spielen geerntet – " +
                    "per One-Click jetzt in allen Spielen nutzbar.");
                RefreshDetail();
            }
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
            RefreshDetail();
        }
        catch (Exception ex) { Log("One-Click fehlgeschlagen: " + ex.Message); }
        finally { SetBusy(false); }
    }

    private async void UpdateGameButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;
        SetBusy(true);
        SaveSettings();
        try
        {
            await EnsureManifestAndLibraryAsync();
            var preset = PresetIfForced;
            var progress = LogProgress();
            await Task.Run(() => _oneClick.UpdateGame(game, preset, progress));
            RefreshDetail();
        }
        catch (Exception ex) { Log("Aktualisierung fehlgeschlagen: " + ex.Message); }
        finally { SetBusy(false); }
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
        Log($"{game.Name}: {PresetForcer.Force(game, SelectedPreset).Message}");
    }

    private async void OptiScalerButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;
        if (MessageBox.Show(
                $"OptiScaler in „{game.Name}“ installieren?\n\nDas lädt das neueste Release von GitHub und " +
                $"legt es als {_settings.OptiScalerProxy} in den Spielordner. Nur für Singleplayer-Spiele " +
                "empfohlen – in Multiplayer-Titeln kann DLL-Injektion zu Anti-Cheat-Sperren führen!",
                "OptiScaler installieren", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;

        SetBusy(true);
        try
        {
            await EnsureManifestAndLibraryAsync();
            var repo = _manifest?.OptiScalerRepo ?? "optiscaler/OptiScaler";
            var result = await new OptiScalerInstaller().InstallAsync(game, repo, _settings.OptiScalerProxy, LogProgress());
            Log($"{game.Name}: {result.Message}");
        }
        catch (Exception ex) { Log("OptiScaler-Installation fehlgeschlagen: " + ex.Message); }
        finally { SetBusy(false); }
    }

    private async void NeuralButton_Click(object sender, RoutedEventArgs e)
    {
        var game = SelectedGame;
        if (_busy || game == null) return;

        var installDir = game.Dlls
            .Select(d => System.IO.Path.GetDirectoryName(d.Path)!)
            .FirstOrDefault() ?? game.InstallDir;

        if (NeuralRenderingInstaller.IsInstalled(installDir))
        {
            if (MessageBox.Show(
                    $"Neural Rendering ist in „{game.Name}“ bereits installiert.\n\nEntfernen?",
                    "Neural Rendering", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
                Log($"{game.Name}: {NeuralRenderingInstaller.Uninstall(installDir).Message}");
            return;
        }

        var routeA = game.Dlls.Any(d => d.Kind == DlssDllKind.SuperResolution);
        var route = routeA
            ? "RenoDX-Route (Spiel hat natives DLSS)"
            : "Feeder-Route (DLSS5-Feeder + LumeniteFX, Spiel ohne natives DLSS)";
        if (MessageBox.Show(
                $"Neural Rendering (fotorealistische Gesichter & Beleuchtung) in „{game.Name}“ installieren?\n\n" +
                $"Methode: {route}.\n" +
                "Es werden Community-Komponenten von GitHub geladen (experimentell, nicht von NVIDIA!) und " +
                "ReShade (Add-on-Build) wird bei Bedarf automatisch von reshade.me mitinstalliert. " +
                "Die nvngx_dlssnr.dll kommt aus deiner DLL-Bibliothek – für RTX 20–40 brauchst du den " +
                "ShortFuse-Kompatibilitäts-Build, für RTX 50 das Original. Nur für Singleplayer-Spiele!",
                "Neural Rendering installieren", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;

        SetBusy(true);
        try
        {
            await EnsureManifestAndLibraryAsync();
            var options = new NrOptions
            {
                WorkingScalePercent = NrScaleCombo.SelectedIndex switch { 0 => 100, 2 => 50, _ => 75 },
            };
            var sources = _manifest?.NeuralRendering ?? new NrSources();
            var result = await new NeuralRenderingInstaller().InstallAsync(game, _library, sources, options, LogProgress());
            Log($"{game.Name}: {result.Message}");
        }
        catch (Exception ex) { Log("Neural-Rendering-Installation fehlgeschlagen: " + ex.Message); }
        finally { SetBusy(false); }
    }

    private async void AddFolderButton_Click(object sender, RoutedEventArgs e)
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
        await Task.CompletedTask;
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
