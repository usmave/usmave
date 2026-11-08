using NeuralSwap.Core.Install;
using NeuralSwap.Core.Library;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.NeuralRendering;
using NeuralSwap.Core.Scanning;
using Xunit;

namespace NeuralSwap.Core.Tests;

public class GameProtectionTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public GameProtectionTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    private Game G(string name = "Spiel") => new() { Name = name, InstallDir = _root, Platform = GamePlatform.Steam };

    [Theory]
    [InlineData("EasyAntiCheat", "Easy Anti-Cheat")]
    [InlineData("EasyAntiCheat_EOS", "Easy Anti-Cheat")]
    [InlineData("BattlEye", "BattlEye")]
    [InlineData("EAAntiCheat", "EA Javelin Anticheat")]
    [InlineData("AntiCheatExpert", "Anti-Cheat Expert (ACE)")]
    public void DetectsAntiCheatFolders(string folder, string expected)
    {
        Directory.CreateDirectory(Path.Combine(_root, "Binaries", folder));
        Assert.Equal(expected, GameProtection.DetectAntiCheat(G()));
    }

    [Theory]
    [InlineData("EasyAntiCheat_EOS_Setup.exe", "Easy Anti-Cheat")]
    [InlineData("BEService_x64.exe", "BattlEye")]
    [InlineData("cod.exe", "Ricochet (Call of Duty)")]
    [InlineData("sp24-cod.exe", "Ricochet (Call of Duty)")]
    public void DetectsAntiCheatFiles(string file, string expected)
    {
        File.WriteAllBytes(Path.Combine(_root, file), new byte[] { 1 });
        Assert.Equal(expected, GameProtection.DetectAntiCheat(G()));
    }

    [Fact]
    public void CallOfDutyIsRecognisedByName()
    {
        Assert.Equal("Ricochet (Call of Duty)", GameProtection.DetectAntiCheat(G("Call of Duty")));
    }

    [Fact]
    public void SinglePlayerGameHasNoAntiCheat()
    {
        File.WriteAllBytes(Path.Combine(_root, "HogwartsLegacy.exe"), new byte[] { 1 });
        Directory.CreateDirectory(Path.Combine(_root, "Engine", "Binaries", "Win64"));
        Assert.Null(GameProtection.DetectAntiCheat(G("Hogwarts Legacy")));
    }

    [Fact]
    public void LockedStoreCopyNeedsConfigAndUnreadableExe()
    {
        var content = Path.Combine(_root, "Content");
        var exe = Path.Combine(content, "TheGreatCircle.exe");
        Directory.CreateDirectory(content);
        File.WriteAllBytes(exe, new byte[] { 1 });
        var game = new Game { Name = "Indiana Jones", InstallDir = content, Platform = GamePlatform.Xbox, MainExe = exe };

        Assert.False(GameProtection.IsLockedStoreCopy(game, _ => false)); // ohne MicrosoftGame.config keine Store-Kopie

        File.WriteAllText(Path.Combine(content, "MicrosoftGame.config"), "<Game/>");
        Assert.True(GameProtection.IsLockedStoreCopy(game, _ => false));
        Assert.False(GameProtection.IsLockedStoreCopy(game, _ => true)); // lesbare EXE: modbare Store-Kopie
    }

    [Fact]
    public void OneClickLeavesAntiCheatGamesAndRestoresEarlierSwaps()
    {
        Directory.CreateDirectory(Path.Combine(_root, "EasyAntiCheat"));
        var dll = Path.Combine(_root, "nvngx_dlssg.dll");
        File.WriteAllBytes(dll, new byte[] { 9 });              // von NeuralSwap getauscht …
        File.WriteAllBytes(dll + ".nsbak", new byte[] { 1 });   // … mit Sicherung des Originals
        var game = G("Online-Shooter");
        game.Dlls.Add(new InstalledDll { Kind = DlssDllKind.FrameGeneration, Path = dll, Version = "310.9.16.0", HasBackup = true });

        var library = new DllLibrary(Path.Combine(_root, "lib"));
        var results = new OneClickService(library, isRtx50: () => true).UpdateAll(new[] { game });

        var result = Assert.Single(results);
        Assert.Equal("Easy Anti-Cheat", result.SkippedReason);
        Assert.Equal(new byte[] { 1 }, File.ReadAllBytes(dll));
        Assert.False(File.Exists(dll + ".nsbak"));
    }
}

public class Dlss5OneClickTextTests
{
    [Fact]
    public void TranslatesGamePassRefusal()
    {
        const string line = "error: Game Pass / Microsoft Store copy (E:\\XboxGames\\Indiana Jones and the Great Circle\\Content): " +
                            "Windows protects this install — the executable is locked or the folder refuses writes — so DLSS 5 cannot be installed on this copy.";
        var german = Dlss5OneClickText.ToGerman(line);
        Assert.StartsWith("Diese Game-Pass-/Store-Installation (E:\\XboxGames\\Indiana Jones and the Great Circle\\Content) schützt Windows", german);
        Assert.Contains("Steam-, Epic- oder GOG-Version", german);
    }

    [Theory]
    [InlineData("Easy Anti-Cheat anti-cheat found in this game. ReShade add-on injection is what it detects: kick at best, ban at worst. Refused.",
        "Anti-Cheat im Spiel gefunden (Easy Anti-Cheat).")]
    [InlineData("Done. In game: Home opens ReShade -> Add-ons tab -> DLSS 5 Neural Rendering -> enable. (Home tab saying no effect files is normal on games with their own DLSS.)",
        "Fertig. Im Spiel DLSS bzw. DLAA einschalten")]
    [InlineData("Done. In game: Insert opens the OptiScaler overlay -> enable Neural Rendering (off by default).",
        "Fertig. Im Spiel öffnet die Einfg-Taste das OptiScaler-Menü")]
    [InlineData("error: this game is on the last setup there is (OptiScaler); nothing further to try.",
        "Das ist bereits das letzte Setup der Liste (OptiScaler)")]
    [InlineData("removed renodx-dlss5.addon64", "entfernt: renodx-dlss5.addon64")]
    [InlineData("[FAIL] No ReShade.log next to the game exe: ReShade never loaded. Either the game was not started since the install.",
        "[FEHLER] Keine ReShade.log neben der Spiel-EXE")]
    [InlineData("[ok  ] DLSS 5 model beside the exe: 310,9,16,0 — NVIDIA original build",
        "[ok] DLSS-5-Modell neben der EXE: 310,9,16,0 – NVIDIA-Originalbuild")]
    [InlineData("[1/4] ReShade (add-on build)", "[1/4] ReShade (Add-on-Version)")]
    [InlineData("setup: ReShade + DLSS 5 add-on (newest build) (step 1 of 5) - the game has its own DLSS · API unknown, assuming DX12 · GPU unknown",
        "Setup: ReShade + DLSS 5 add-on (neueste Version) (Stufe 1 von 5) - Spiel hat eigenes DLSS · API unbekannt, DX12 angenommen · GPU unbekannt")]
    [InlineData("error: something new went wrong", "Fehler (Originalmeldung): something new went wrong")]
    public void TranslatesKnownLines(string english, string germanStart)
    {
        Assert.StartsWith(germanStart, Dlss5OneClickText.ToGerman(english));
    }

    [Theory]
    [InlineData(new string[0], "Installieren/Aktualisieren")]
    [InlineData(new[] { "--diagnose" }, "Diagnose")]
    [InlineData(new[] { "--remove-all" }, "Entfernen (inklusive ReShade)")]
    public void ActionLabelsAreGerman(string[] flags, string expected) =>
        Assert.Equal(expected, NeuralRenderingService.ActionLabel(flags));

    [Fact]
    public void LeavesUnknownTextReadable()
    {
        Assert.Equal("ok: dxgi.dll", Dlss5OneClickText.ToGerman("ok: dxgi.dll"));
    }
}

public class NeuralRenderingRefusalTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public NeuralRenderingRefusalTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public async Task RefusesCallOfDutyWithoutRunningTheTool()
    {
        var runner = new FakeRunner();
        var service = new NeuralRenderingService(new HttpClient(new FakeHttp()), runner, new Dlss5OneClickSource(),
            Path.Combine(_root, "tools"), Path.Combine(_root, "state"));
        var game = new Game { Name = "Call of Duty", InstallDir = _root, Platform = GamePlatform.Steam };

        var outcome = await service.InstallAsync(game);

        Assert.False(outcome.Success);
        Assert.Contains("Anti-Cheat", outcome.Message);
        Assert.Empty(runner.Calls);
    }
}
