using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using NeuralSwap.Core.Install;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.NeuralRendering;
using NeuralSwap.Core.Presets;
using Xunit;

namespace NeuralSwap.Core.Tests;

/// <summary>Simuliert api.github.com und Release-Downloads.</summary>
internal sealed class FakeHttp : HttpMessageHandler
{
    public Dictionary<string, Func<HttpResponseMessage>> Routes { get; } = new();
    public List<string> Requests { get; } = new();

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var url = request.RequestUri!.ToString();
        Requests.Add(url);
        var route = Routes.FirstOrDefault(r => url.StartsWith(r.Key, StringComparison.Ordinal));
        return Task.FromResult(route.Value?.Invoke() ?? new HttpResponseMessage(HttpStatusCode.NotFound));
    }

    public static HttpResponseMessage Json(object value) =>
        new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(value)) };

    public static HttpResponseMessage Bytes(byte[] value) =>
        new(HttpStatusCode.OK) { Content = new ByteArrayContent(value) };
}

/// <summary>Merkt sich Aufrufe externer Programme und spielt vorgegebene Ausgaben ab.</summary>
internal sealed class FakeRunner : IProcessRunner
{
    public List<(string File, List<string> Args)> Calls { get; } = new();
    public Func<List<string>, ProcessResult> Respond { get; set; } = _ => new ProcessResult(0, "Done. In game: ok", false);

    public Task<ProcessResult> RunAsync(string fileName, IReadOnlyList<string> arguments, TimeSpan timeout,
        Action<string>? onLine = null, CancellationToken ct = default)
    {
        var args = arguments.ToList();
        Calls.Add((fileName, args));
        var result = Respond(args);
        foreach (var line in result.Output.Split('\n')) onLine?.Invoke(line);
        return Task.FromResult(result);
    }
}

public class NeuralRenderingServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));
    private readonly FakeHttp _http = new();
    private readonly FakeRunner _runner = new();
    private readonly byte[] _toolExe = TestPe.Build(is64Bit: true, minSize: 200_000);

    public NeuralRenderingServiceTests()
    {
        Directory.CreateDirectory(_root);
        var digest = "sha256:" + Convert.ToHexString(SHA256.HashData(_toolExe)).ToLowerInvariant();
        _http.Routes["https://api.github.com/repos/faisalkindi/DLSS5oneclick/releases"] = () => FakeHttp.Json(new[]
        {
            new { tag_name = "v0.15.0-rc1", draft = false, prerelease = true, published_at = "2026-10-26T10:00:00Z",
                  assets = new[] { new { name = "dlss5oneclick.exe", browser_download_url = "https://dl/rc.exe", size = 1, digest = (string?)null } } },
            new { tag_name = "v0.14.28", draft = false, prerelease = false, published_at = "2026-10-20T10:00:00Z",
                  assets = new[] { new { name = "dlss5oneclick.exe", browser_download_url = "https://dl/stable.exe", size = 1, digest = (string?)digest } } },
        });
        _http.Routes["https://dl/stable.exe"] = () => FakeHttp.Bytes(_toolExe);
    }

    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    private NeuralRenderingService Service() =>
        new(new HttpClient(_http), _runner, new Dlss5OneClickSource(),
            toolsRoot: Path.Combine(_root, "tools"), stateRoot: Path.Combine(_root, "state"));

    private Game MakeGame(bool reshade = false)
    {
        var dir = Path.Combine(_root, "game");
        Directory.CreateDirectory(dir);
        var exe = Path.Combine(dir, "Game.exe");
        TestPe.Write(exe, is64Bit: true);
        if (reshade)
            TestPe.Write(Path.Combine(dir, "dxgi.dll"), is64Bit: true,
                exports: new[] { "ReShadeRegisterAddon", "ReShadeUnregisterAddon" });
        return new Game { Name = "Test", InstallDir = dir, Platform = GamePlatform.Steam, MainExe = exe };
    }

    [Fact]
    public async Task InstallDownloadsStableToolVerifiesDigestAndPassesGameExe()
    {
        var game = MakeGame();

        var outcome = await Service().InstallAsync(game);

        Assert.True(outcome.Success, outcome.Message);
        var call = Assert.Single(_runner.Calls);
        Assert.EndsWith(Path.Combine("v0.14.28", "dlss5oneclick.exe"), call.File);
        Assert.Equal(new[] { game.MainExe! }, call.Args);
        Assert.DoesNotContain("https://dl/rc.exe", _http.Requests);
    }

    [Fact]
    public async Task DigestMismatchAbortsBeforeRunningAnything()
    {
        _http.Routes["https://dl/stable.exe"] = () => FakeHttp.Bytes(TestPe.Build(true, minSize: 200_001));

        var outcome = await Assert.ThrowsAsync<InvalidOperationException>(() => Service().InstallAsync(MakeGame()));

        Assert.Contains("Prüfsumme", outcome.Message);
        Assert.Empty(_runner.Calls);
    }

    [Fact]
    public async Task RemoveTakesReShadeOnlyWhenItWasNotThereBefore()
    {
        var game = MakeGame(reshade: false);
        await Service().InstallAsync(game);
        await Service().UninstallAsync(game);
        Assert.Equal("--remove-all", _runner.Calls.Last().Args.Last());

        Directory.Delete(Path.Combine(_root, "game"), true);
        Directory.Delete(Path.Combine(_root, "state"), true);
        var withReShade = MakeGame(reshade: true);
        await Service().InstallAsync(withReShade);
        await Service().UninstallAsync(withReShade);
        Assert.Equal("--remove", _runner.Calls.Last().Args.Last());
    }

    [Fact]
    public async Task RemoveDeletesOrphanedModelBackup()
    {
        var game = MakeGame();
        await Service().InstallAsync(game);
        // One-Click hat das Modell getauscht, DLSS5oneclick entfernt danach die DLL selbst:
        File.WriteAllBytes(Path.Combine(game.ModDir, "nvngx_dlssnr.dll.nsbak"), new byte[] { 1 });

        await Service().UninstallAsync(game);

        Assert.False(File.Exists(Path.Combine(game.ModDir, "nvngx_dlssnr.dll.nsbak")));
    }

    [Fact]
    public async Task RemoveWithoutOwnRecordKeepsReShade()
    {
        var game = MakeGame(reshade: true);

        await Service().UninstallAsync(game);

        Assert.Equal("--remove", _runner.Calls.Single().Args.Last());
    }

    [Fact]
    public async Task FailureReportsToolError()
    {
        _runner.Respond = _ => new ProcessResult(1, "[1/3] ReShade\n\nerror: dxgi.dll already exists, but does not belong to ReShade", false);

        var outcome = await Service().InstallAsync(MakeGame());

        Assert.False(outcome.Success);
        Assert.Contains("error: dxgi.dll already exists", outcome.Message);
    }

    [Fact]
    public async Task DiagnoseAndNextSetupPassTheirFlags()
    {
        var game = MakeGame();
        await Service().DiagnoseAsync(game);
        await Service().NextSetupAsync(game);

        Assert.Equal("--diagnose", _runner.Calls[0].Args.Last());
        Assert.Equal("--next-setup", _runner.Calls[1].Args.Last());
    }

    [Fact]
    public void EnableHooksIsSetAndRemovedWithBackup()
    {
        var game = MakeGame(reshade: true);
        File.WriteAllBytes(Path.Combine(game.ModDir, "renodx-dlss5.addon64"), TestPe.Build(true));
        var ini = Path.Combine(game.ModDir, "ReShade.ini");
        File.WriteAllLines(ini, new[] { "[GENERAL]", "PresetPath=.\\ReShadePreset.ini", "", "[RenoDX.DLSS5]", "NRHookPoint=1" });

        var set = Service().SetEnableHooks(game, enable: true);
        Assert.True(set.Success, set.Message);
        Assert.Equal("1", IniFile.Load(ini).Get("RenoDX.DLSS5", "EnableHooks"));
        Assert.Equal("1", IniFile.Load(ini).Get("RenoDX.DLSS5", "NRHookPoint"));
        Assert.True(File.Exists(ini + ".nsbak"));

        var removed = Service().SetEnableHooks(game, enable: false);
        Assert.True(removed.Success, removed.Message);
        Assert.Null(IniFile.Load(ini).Get("RenoDX.DLSS5", "EnableHooks"));
    }

    [Fact]
    public void EnableHooksRefusedWithoutRenoDxAddon()
    {
        Assert.False(Service().SetEnableHooks(MakeGame(reshade: true), enable: true).Success);
    }

    [Theory]
    [InlineData("\r  5% downloading ReShade\r 87% downloading ReShade", null)]
    [InlineData("\r100% done                                     ", null)]
    [InlineData("      ok: ReShade 6.8.0 as dxgi.dll", "ok: ReShade 6.8.0 as dxgi.dll")]
    [InlineData(" 42% fetching\r[2/4] RenoDX DLSS 5 add-on", "[2/4] RenoDX DLSS 5 add-on")]
    public void CleanLineDropsProgressSegments(string raw, string? expected)
    {
        Assert.Equal(expected, Dlss5OneClick.CleanLine(raw));
    }

    [Fact]
    public void SummaryPrefersDoneOrErrorLine()
    {
        const string output = "using C:\\Game.exe\n[1/2] ReShade\n      ok: done\n\nDone. In game: Home opens ReShade -> Add-ons tab";
        Assert.StartsWith("Done. In game", NeuralRenderingService.Summary(output, "Done."));
        Assert.Equal("Done. In game: Home opens ReShade -> Add-ons tab", NeuralRenderingService.Summary(output, "error:"));
    }
}

public class NrStatusTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public NrStatusTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    private Game Game() => new() { Name = "x", InstallDir = _root, Platform = GamePlatform.Steam };

    [Fact]
    public void DetectsAddonsMarkersReShadeAndOptiScaler()
    {
        File.WriteAllBytes(Path.Combine(_root, "renodx-dlss5-8.5.0.addon64"), new byte[] { 1 });
        File.WriteAllBytes(Path.Combine(_root, "dlss5-feed.addon64"), new byte[] { 1 });
        File.WriteAllText(Path.Combine(_root, "renodx-dlss5.settings.dlss5oneclick"), "x");
        File.WriteAllText(Path.Combine(_root, "ReShade.ini"), "[RenoDX.DLSS5]\nEnableHooks=2\n");

        var status = NrStatus.Detect(Game());

        Assert.Equal(NeuralConsumer.RenoDxDlss5, status.Consumer);
        Assert.True(status.FeederPresent);
        Assert.True(status.InstalledByDlss5OneClick);
        Assert.True(status.ReShadePresent);
        Assert.Equal("2", status.EnableHooks);
        Assert.False(status.OptiScalerPresent);
    }

    [Theory]
    [InlineData("deep-fried-chicken.addon64", NeuralConsumer.DeepFriedChicken)]
    [InlineData("renodx-dlss.addon64", NeuralConsumer.RenoDxDlssShortFuse)]
    [InlineData("renodx-dlss5.addon64", NeuralConsumer.RenoDxDlss5)]
    [InlineData("renodx-hogwartslegacy.addon64", NeuralConsumer.None)]
    public void RecognisesConsumers(string file, NeuralConsumer expected)
    {
        File.WriteAllBytes(Path.Combine(_root, file), new byte[] { 1 });
        Assert.Equal(expected, NrStatus.Detect(Game()).Consumer);
    }

    [Fact]
    public void RecognisesReShadeModuleByExportAndOptiScalerByIni()
    {
        TestPe.Write(Path.Combine(_root, "dxgi.dll"), true, exports: new[] { "ReShadeRegisterAddon" });
        File.WriteAllText(Path.Combine(_root, "OptiScaler.ini"), "[DLSS]");

        var status = NrStatus.Detect(Game());

        Assert.True(status.ReShadePresent);
        Assert.True(status.OptiScalerPresent);
        Assert.False(status.HasNeuralRendering);
    }
}

public class AppSettingsMigrationTests : IDisposable
{
    private readonly string _file = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N") + ".json");

    public void Dispose() { try { File.Delete(_file); } catch { } }

    [Fact]
    public void Version1PresetBIsResetAndDisabled()
    {
        File.WriteAllText(_file, """{ "manualFolders": ["E:\\Spiele"], "preferredPreset": "B", "forcePresetOnOneClick": true }""");

        var s = AppSettings.Load(_file);

        Assert.True(s.PresetMigrated);
        Assert.False(s.ForcePresetOnOneClick);
        Assert.Equal(PresetChoice.Latest, s.PreferredPresetChoice);
        Assert.Equal(AppSettings.CurrentVersion, s.SettingsVersion);
        Assert.Equal(new[] { "E:\\Spiele" }, s.ManualFolders);
    }

    [Fact]
    public void CurrentSettingsStayUntouched()
    {
        File.WriteAllText(_file, """{ "settingsVersion": 2, "preferredPreset": "M", "forcePresetOnOneClick": true }""");

        var s = AppSettings.Load(_file);

        Assert.False(s.PresetMigrated);
        Assert.True(s.ForcePresetOnOneClick);
        Assert.Equal(PresetChoice.M, s.PreferredPresetChoice);
    }

    [Fact]
    public void FreshInstallUsesSafeDefaults()
    {
        var s = AppSettings.Load(_file);

        Assert.False(s.ForcePresetOnOneClick);
        Assert.Equal(PresetChoice.Latest, s.PreferredPresetChoice);
        Assert.Equal(AppSettings.CurrentVersion, s.SettingsVersion);
    }
}

public class GpuAndModelSwapTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public GpuAndModelSwapTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Theory]
    [InlineData("NVIDIA GeForce RTX 5090", true)]
    [InlineData("NVIDIA GeForce RTX 5070 Ti Laptop GPU", true)]
    [InlineData("NVIDIA RTX PRO 6000 Blackwell Workstation Edition", true)]
    [InlineData("NVIDIA GeForce RTX 4090", false)]
    [InlineData("NVIDIA GeForce RTX 3080", false)]
    [InlineData(null, false)]
    public void RecognisesRtx50(string? name, bool expected) =>
        Assert.Equal(expected, NeuralSwap.Core.Hardware.GpuInfo.IsRtx50(name));

    private (Game Game, string Dll) GameWithToolModel(bool sidecar)
    {
        var dir = Path.Combine(_root, "game");
        Directory.CreateDirectory(dir);
        var dll = Path.Combine(dir, "nvngx_dlssnr.dll");
        File.WriteAllBytes(dll, new byte[] { 1 });
        if (sidecar) File.WriteAllText(dll + ".dlss5oneclick", "dlssnr-310.8.SF-v2");
        var game = new Game { Name = "Spiel", InstallDir = dir, Platform = GamePlatform.Steam };
        game.Dlls.Add(new InstalledDll { Kind = DlssDllKind.NeuralRendering, Path = dll, Version = "310.8.SF.0" });
        return (game, dll);
    }

    private NeuralSwap.Core.Library.DllLibrary LibraryWith31091600()
    {
        var library = new NeuralSwap.Core.Library.DllLibrary(Path.Combine(_root, "lib"));
        var dir = Path.Combine(library.Root, "nvngx_dlssnr.dll", "310.9.16.0");
        Directory.CreateDirectory(dir);
        File.WriteAllBytes(Path.Combine(dir, "nvngx_dlssnr.dll"), new byte[] { 9, 9 });
        return library;
    }

    [Fact]
    public void KeepsToolModelOnOlderGpus()
    {
        var (game, dll) = GameWithToolModel(sidecar: true);

        var result = new OneClickService(LibraryWith31091600(), isRtx50: () => false).UpdateGame(game);

        Assert.True(Assert.Single(result.Swaps).Skipped);
        Assert.Equal(new byte[] { 1 }, File.ReadAllBytes(dll));
    }

    [Fact]
    public void UsesNewestModelOnRtx50()
    {
        var (game, dll) = GameWithToolModel(sidecar: true);

        var result = new OneClickService(LibraryWith31091600(), isRtx50: () => true).UpdateGame(game);

        Assert.False(Assert.Single(result.Swaps).Skipped);
        Assert.Equal(new byte[] { 9, 9 }, File.ReadAllBytes(dll));
        Assert.True(File.Exists(dll + ".nsbak"));
    }

    [Fact]
    public void SwapsNonToolModelRegardlessOfGpu()
    {
        var (game, dll) = GameWithToolModel(sidecar: false);

        new OneClickService(LibraryWith31091600(), isRtx50: () => false).UpdateGame(game);

        Assert.Equal(new byte[] { 9, 9 }, File.ReadAllBytes(dll));
    }
}
