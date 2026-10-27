// Integrationstest gegen die echten Downloads – läuft in GitHub Actions auf windows-latest.
// Prüft, was Unit-Tests nicht können: echte Release-Assets und Hashes, das echte
// DLSS5oneclick-CLI (Installieren, Diagnose, Entfernen), das echte OptiScaler-Archiv
// und dass nach dem Entfernen jeder Spielordner wieder exakt im Ursprungszustand ist.

using System.Diagnostics;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using NeuralSwap.Core.Install;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.NeuralRendering;
using NeuralSwap.Core.OptiScaler;
using NeuralSwap.Core.Pe;
using NeuralSwap.Core.Scanning;

var failures = 0;
void Ok(string text) => Console.WriteLine($"[ OK ] {text}");
void Warn(string text) => Console.WriteLine($"[WARN] {text}");
void Fail(string text) { failures++; Console.WriteLine($"[FAIL] {text}"); }
void Check(bool condition, string text) { if (condition) Ok(text); else Fail(text); }
void Section(string title) => Console.WriteLine($"\n===== {title} =====");

if (!OperatingSystem.IsWindows())
{
    Console.WriteLine("Dieser Test läuft nur unter Windows.");
    return 2;
}

var work = Path.Combine(Path.GetTempPath(), "neuralswap-it-" + Guid.NewGuid().ToString("N")[..8]);
var stateRoot = Path.Combine(work, "state");
var toolsRoot = Path.Combine(work, "tools");
var sys32 = Environment.GetFolderPath(Environment.SpecialFolder.System);
Directory.CreateDirectory(work);

var http = new HttpClient(new GitHubTokenHandler(Environment.GetEnvironmentVariable("GITHUB_TOKEN")))
{
    Timeout = TimeSpan.FromMinutes(10),
};
http.DefaultRequestHeaders.UserAgent.ParseAdd("NeuralSwap-IntegrationTest");
var progress = new SyncProgress(line => Console.WriteLine("       " + line));

Dictionary<string, string> Fingerprint(string dir) =>
    Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories)
        .ToDictionary(f => Path.GetRelativePath(dir, f),
            f => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(f))), StringComparer.OrdinalIgnoreCase);

void CompareToOriginal(string dir, Dictionary<string, string> before, string what)
{
    var after = Fingerprint(dir);
    var added = after.Keys.Except(before.Keys, StringComparer.OrdinalIgnoreCase).ToList();
    var missing = before.Keys.Except(after.Keys, StringComparer.OrdinalIgnoreCase).ToList();
    var changed = before.Keys.Intersect(after.Keys, StringComparer.OrdinalIgnoreCase)
        .Where(k => before[k] != after[k]).ToList();
    Check(added.Count == 0 && missing.Count == 0 && changed.Count == 0,
        $"{what}: Ordner nach dem Entfernen wieder im Ursprungszustand" +
        (added.Count + missing.Count + changed.Count == 0 ? "" :
            $" (übrig: {string.Join(", ", added)}; fehlt: {string.Join(", ", missing)}; geändert: {string.Join(", ", changed)})"));
}

string MakeGame(string name, bool withDlss)
{
    var dir = Path.Combine(work, "games", name);
    Directory.CreateDirectory(dir);
    File.Copy(Path.Combine(sys32, "notepad.exe"), Path.Combine(dir, "Game.exe"));
    if (withDlss)
        File.Copy(Path.Combine(sys32, "version.dll"), Path.Combine(dir, "nvngx_dlss.dll"));
    return dir;
}

Game GameFor(string dir)
{
    var game = new Game { Name = Path.GetFileName(dir), InstallDir = dir, Platform = GamePlatform.Steam };
    GameScanner.Refresh(game);
    return game;
}

try
{
    // ------------------------------------------------------------------ PE-Leser
    Section("PE-Leser gegen echte Windows-Dateien");
    var kernel32 = PeInfo.TryRead(Path.Combine(sys32, "kernel32.dll"));
    Check(kernel32 != null && kernel32.Is64Bit && kernel32.Exports.Contains("CreateFileW"),
        $"kernel32.dll: 64 Bit, {kernel32?.Exports.Count} Exporte inkl. CreateFileW");
    var notepad = PeInfo.TryRead(Path.Combine(sys32, "notepad.exe"));
    Check(notepad != null && notepad.Is64Bit && notepad.Imports.Count > 0,
        $"notepad.exe: 64 Bit, Importe: {string.Join(", ", notepad?.Imports.Take(5) ?? Array.Empty<string>())}");

    // ------------------------------------------------------------------ Neural Rendering
    Section("Neural Rendering über DLSS5oneclick (Spiel mit eigenem DLSS)");
    var nrDir = MakeGame("NativeDlssGame", withDlss: true);
    var nrBefore = Fingerprint(nrDir);
    var nrGame = GameFor(nrDir);
    Check(nrGame.MainExe?.EndsWith("Game.exe") == true, $"Spiel-EXE erkannt: {nrGame.MainExe}");

    var nr = new NeuralRenderingService(http, new ProcessRunner(), new Dlss5OneClickSource(), toolsRoot, stateRoot);

    // --check zeigt die Planung des Tools (nur zur Diagnose im Log).
    var tool = await new Dlss5OneClick(http, new ProcessRunner(), new Dlss5OneClickSource(), toolsRoot)
        .EnsureAsync(progress);
    Check(Dlss5OneClick.IsValidTool(tool.ExePath), $"DLSS5oneclick {tool.Tag} geladen und Hash geprüft");
    var check = await new Dlss5OneClick(http, new ProcessRunner(), new Dlss5OneClickSource(), toolsRoot)
        .RunAsync(tool, nrGame.MainExe!, new[] { "--check" });
    Console.WriteLine("       --check (Exit " + check.ExitCode + "):\n" +
                      string.Join("\n", check.Output.Split('\n').Select(l => "         " + l.TrimEnd())));
    Check(check.ExitCode == 0 && check.Output.Contains("plan:"), "DLSS5oneclick --check liefert einen Plan");

    var install = await nr.InstallAsync(nrGame, progress);
    Check(install.Success, "Installieren: " + install.Message);
    var afterInstall = nr.GetStatus(nrGame);
    Console.WriteLine("       Status: " + afterInstall.Describe());
    Check(afterInstall.ReShadePresent, "ReShade liegt neben der Spiel-EXE");
    Check(afterInstall.HasNeuralRendering, "Neural-Add-on bzw. DLSS5oneclick-Marker vorhanden");
    foreach (var f in Directory.EnumerateFiles(nrDir).Select(Path.GetFileName)) Console.WriteLine("         · " + f);

    var hooks = nr.SetEnableHooks(nrGame, enable: true);
    if (afterInstall.Consumer == NeuralConsumer.RenoDxDlss5)
    {
        Check(hooks.Success && nr.GetStatus(nrGame).EnableHooks == "1", "EnableHooks=1 gesetzt");
        Check(nr.SetEnableHooks(nrGame, enable: false).Success && nr.GetStatus(nrGame).EnableHooks == null,
            "EnableHooks wieder entfernt");
        File.Delete(Path.Combine(nrDir, "ReShade.ini.nsbak"));
    }
    else Warn($"EnableHooks-Test übersprungen (Consumer: {afterInstall.Consumer})");

    // Neues NR-Modell (offiziell, RTX 50) aus rhi-repo – wie es die DLL-Ernte z. B. aus Metro holt.
    var releases = await new GitHubReleases(http).GetReleasesAsync("RankFTW/rhi-repo", maxPages: 3);
    var modelRelease = GitHubReleases.PickLatest(releases, @"^dlssnr-310\.9\.16$",
        a => a.Name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase));
    if (modelRelease == null)
    {
        Warn("dlssnr-310.9.16 nicht im rhi-repo gefunden – Modell-Tausch-Test übersprungen");
    }
    else
    {
        var asset = modelRelease.Assets.First(a => a.Name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase));
        var zipPath = Path.Combine(work, "model", asset.Name);
        await new GitHubReleases(http).DownloadAsync(asset.Url, zipPath, asset.Digest);
        var extracted = Path.Combine(work, "model", "nvngx_dlssnr.dll");
        using (var zip = System.IO.Compression.ZipFile.OpenRead(zipPath))
            zip.Entries.First(e => e.Name.Equals("nvngx_dlssnr.dll", StringComparison.OrdinalIgnoreCase))
                .ExtractToFile(extracted, overwrite: true);
        var library = new NeuralSwap.Core.Library.DllLibrary(Path.Combine(work, "library"));
        var imported = library.Import(extracted);
        Check(imported.Version.StartsWith("310.9.16"), $"echtes Modell aus {modelRelease.TagName} importiert: {imported.Version}");

        GameScanner.Refresh(nrGame);
        var nrDll = Path.Combine(nrDir, "nvngx_dlssnr.dll");
        var toolModel = FileVersionInfo.GetVersionInfo(nrDll).FileVersion;

        new NeuralSwap.Core.OneClickService(library, isRtx50: () => false).UpdateGame(nrGame, progress: progress);
        Check(FileVersionInfo.GetVersionInfo(nrDll).FileVersion == toolModel,
            $"RTX 20–40: DLSS5oneclick-Modell bleibt ({toolModel})");

        new NeuralSwap.Core.OneClickService(library, isRtx50: () => true).UpdateGame(nrGame, progress: progress);
        var swapped = FileVersionInfo.GetVersionInfo(nrDll).FileVersion;
        Check(swapped?.Replace(',', '.').Replace(" ", "").StartsWith("310.9.16") == true && File.Exists(nrDll + ".nsbak"),
            $"RTX 50: Modell auf {swapped} getauscht, Sicherung vorhanden");
    }

    var diagnose = await nr.DiagnoseAsync(nrGame, progress);
    Console.WriteLine("       Diagnose: " + diagnose.Message + " (ohne Spielstart sind FAIL-Zeilen erwartbar)");

    var remove = await nr.UninstallAsync(nrGame, progress);
    Check(remove.Success, "Entfernen: " + remove.Message);
    CompareToOriginal(nrDir, nrBefore, "Neural Rendering");

    // ------------------------------------------------------------------ OptiScaler
    Section("OptiScaler (echtes Release, belegtes dxgi.dll)");
    var optiDir = MakeGame("NoDlssGame", withDlss: false);
    File.Copy(Path.Combine(sys32, "version.dll"), Path.Combine(optiDir, "dxgi.dll")); // fremde Proxy-DLL
    var optiBefore = Fingerprint(optiDir);
    var optiGame = GameFor(optiDir);
    var opti = new OptiScalerInstaller(http, Path.Combine(work, "cache"), stateRoot);

    var optiInstall = await opti.InstallAsync(optiGame, "optiscaler/OptiScaler", "dxgi.dll", progress);
    Check(optiInstall.Success, "OptiScaler installieren: " + optiInstall.Message);
    Check(File.Exists(Path.Combine(optiDir, "winmm.dll")), "OptiScaler als winmm.dll abgelegt (dxgi.dll war belegt)");
    Check(Fingerprint(optiDir)["dxgi.dll"] == optiBefore["dxgi.dll"], "vorhandene dxgi.dll unverändert");
    Check(File.Exists(Path.Combine(optiDir, "OptiScaler.ini")), "OptiScaler.ini vorhanden");
    var product = FileVersionInfo.GetVersionInfo(Path.Combine(optiDir, "winmm.dll")).ProductName;
    Check(product?.Contains("OptiScaler", StringComparison.OrdinalIgnoreCase) == true,
        $"winmm.dll ist OptiScaler (Produktname: {product})");
    foreach (var f in Directory.EnumerateFileSystemEntries(optiDir).Select(Path.GetFileName)) Console.WriteLine("         · " + f);

    var optiRemove = opti.Uninstall(optiGame);
    Check(optiRemove.Success, "OptiScaler entfernen: " + optiRemove.Message);
    CompareToOriginal(optiDir, optiBefore, "OptiScaler");
}
catch (Exception ex)
{
    Fail("Unerwartete Ausnahme: " + ex);
}
finally
{
    try { Directory.Delete(work, recursive: true); } catch { }
}

Console.WriteLine(failures == 0 ? "\nALLE PRÜFUNGEN BESTANDEN" : $"\n{failures} PRÜFUNG(EN) FEHLGESCHLAGEN");
return failures == 0 ? 0 : 1;

/// <summary>Schickt das CI-Token nur an api.github.com – nie an andere Hosts.</summary>
sealed class GitHubTokenHandler : DelegatingHandler
{
    private readonly string? _token;

    public GitHubTokenHandler(string? token) : base(new HttpClientHandler()) => _token = token;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(_token) && request.RequestUri?.Host == "api.github.com")
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        return base.SendAsync(request, ct);
    }
}

/// <summary>Progress, das sofort schreibt (Konsolen-App ohne SynchronizationContext).</summary>
sealed class SyncProgress : IProgress<string>
{
    private readonly Action<string> _write;
    public SyncProgress(Action<string> write) => _write = write;
    public void Report(string value) => _write(value);
}
