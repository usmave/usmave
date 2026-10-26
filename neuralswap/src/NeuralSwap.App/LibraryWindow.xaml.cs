using System.Windows;
using Microsoft.Win32;
using NeuralSwap.Core.Library;
using NeuralSwap.Core.Models;

namespace NeuralSwap.App;

public partial class LibraryWindow : Window
{
    private readonly DllLibrary _library;
    private readonly ManifestService _manifests;
    private readonly VersionManifest _manifest;
    private readonly Action<string> _log;

    private sealed record EntryRow(string KindName, string Version, string Path);

    public LibraryWindow(DllLibrary library, ManifestService manifests, VersionManifest manifest, Action<string> log)
    {
        InitializeComponent();
        _library = library;
        _manifests = manifests;
        _manifest = manifest;
        _log = log;
        Refresh();
    }

    private void Refresh()
    {
        EntriesList.ItemsSource = _library.List()
            .OrderBy(e => e.Kind)
            .ThenByDescending(e => DllLibrary.ParseVersion(e.Version))
            .Select(e => new EntryRow(e.Kind.DisplayName(), e.Version, e.Path))
            .ToList();
    }

    private void ImportButton_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "DLSS-DLL auswählen",
            Filter = "DLSS-DLLs|nvngx_dlss.dll;nvngx_dlssg.dll;nvngx_dlssd.dll;nvngx_dlssnr.dll|Alle DLLs|*.dll",
            Multiselect = true,
        };
        if (dialog.ShowDialog(this) != true) return;

        foreach (var file in dialog.FileNames)
        {
            try
            {
                var entry = _library.Import(file);
                _log($"Importiert: {entry.Kind.DisplayName()} {entry.Version}");
            }
            catch (Exception ex) { _log("Import fehlgeschlagen: " + ex.Message); }
        }
        Refresh();
    }

    private async void DownloadButton_Click(object sender, RoutedEventArgs e)
    {
        DownloadButton.IsEnabled = false;
        try
        {
            if (_manifest.Dlls.Count == 0)
            {
                _log("Manifest ist leer oder konnte nicht geladen werden.");
                return;
            }

            var progress = new Progress<string>(_log);
            var any = false;
            foreach (var dll in _manifest.Dlls.Where(d => d.Sources.Count > 0))
            {
                any = true;
                try { await _manifests.DownloadAsync(dll, _library, progress); }
                catch (Exception ex) { _log(ex.Message); }
            }
            if (!any)
                _log("Im Manifest sind keine Download-Quellen hinterlegt – bitte DLLs manuell importieren " +
                     "oder eigene Quellen-URLs ins Manifest eintragen.");
        }
        finally
        {
            DownloadButton.IsEnabled = true;
            Refresh();
        }
    }
}
