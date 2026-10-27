using NeuralSwap.Core.Library;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.Presets;
using Xunit;

namespace NeuralSwap.Core.Tests;

public class IniFileTests
{
    [Fact]
    public void SetUpdatesExistingKeyAndPreservesRest()
    {
        var ini = new IniFile(new[]
        {
            "; Kommentar",
            "[Dlss]",
            "RenderPresetOverride=false",
            "",
            "[Other]",
            "Key=1",
        });

        ini.Set("Dlss", "RenderPresetOverride", "true");
        ini.Set("Dlss", "RenderPresetForAll", "B");

        Assert.Equal("true", ini.Get("Dlss", "RenderPresetOverride"));
        Assert.Equal("B", ini.Get("Dlss", "RenderPresetForAll"));
        Assert.Equal("1", ini.Get("Other", "Key"));
    }

    [Fact]
    public void SetCreatesMissingSection()
    {
        var ini = new IniFile();
        ini.Set("DLSSPresets", "Global", "K");
        Assert.Equal("K", ini.Get("DLSSPresets", "Global"));
    }
}

public class PresetForcerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public PresetForcerTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    private Game MakeGame()
    {
        var game = new Game { Name = "Test", InstallDir = _root, Platform = GamePlatform.Manual };
        var dll = Path.Combine(_root, "nvngx_dlssnr.dll");
        File.WriteAllBytes(dll, new byte[] { 1 });
        game.Dlls.Add(new InstalledDll { Kind = DlssDllKind.NeuralRendering, Path = dll });
        return game;
    }

    [Theory]
    [InlineData(PresetChoice.K, "11")]
    [InlineData(PresetChoice.L, "12")]
    [InlineData(PresetChoice.M, "13")]
    [InlineData(PresetChoice.Latest, "16777215")]
    public void WritesOptiScalerIntegerValues(PresetChoice choice, string expected)
    {
        // OptiScaler liest RenderPresetForAll per readInt (Config.cpp) – Buchstaben würden ignoriert.
        File.WriteAllLines(Path.Combine(_root, "OptiScaler.ini"), new[] { "[DLSS]", "RenderPresetOverride=false" });

        var result = PresetForcer.Apply(MakeGame(), choice);

        Assert.True(result.Applied, result.Message);
        var ini = IniFile.Load(result.ConfigFile!);
        Assert.Equal("true", ini.Get("DLSS", "RenderPresetOverride"));
        Assert.Equal(expected, ini.Get("DLSS", "RenderPresetForAll"));
    }

    [Fact]
    public void GameDefaultTurnsOverrideOff()
    {
        File.WriteAllLines(Path.Combine(_root, "OptiScaler.ini"),
            new[] { "[DLSS]", "RenderPresetOverride=true", "RenderPresetForAll=11" });

        var result = PresetForcer.Apply(MakeGame(), PresetChoice.GameDefault);

        Assert.True(result.Applied, result.Message);
        Assert.Equal("false", IniFile.Load(result.ConfigFile!).Get("DLSS", "RenderPresetOverride"));
    }

    [Fact]
    public void WithoutOptiScalerNothingIsWritten()
    {
        var result = PresetForcer.Apply(MakeGame(), PresetChoice.M);

        Assert.False(result.Applied);
        Assert.Contains("NVIDIA App", result.Message);
        Assert.False(File.Exists(Path.Combine(_root, "dlsstweaks.ini")));
        Assert.False(File.Exists(Path.Combine(_root, "OptiScaler.ini")));
    }
}

public class LegacyCleanupTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public LegacyCleanupTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    private Game MakeGame() => new() { Name = "Test", InstallDir = _root, Platform = GamePlatform.Manual };

    [Fact]
    public void RemovesFileWrittenByOldPresetForcer()
    {
        // Genau das, was Version 1 für jedes Spiel angelegt hat.
        File.WriteAllLines(Path.Combine(_root, "dlsstweaks.ini"), new[] { "[DLSSPresets]", "Global=B" });

        Assert.Equal(1, LegacyCleanup.RemoveInertDlssTweaksIni(MakeGame()));
        Assert.False(File.Exists(Path.Combine(_root, "dlsstweaks.ini")));
    }

    [Fact]
    public void RemovesFileWrittenByOldQualityTweaker()
    {
        File.WriteAllLines(Path.Combine(_root, "dlsstweaks.ini"), new[]
        {
            "[DLSSPresets]", "Global=B", "", "[DLSS]", "ForceDLAA=false",
            "", "[DLSSQualityLevels]", "Enable=true", "Quality=0.666667", "Performance=0.666667",
        });

        Assert.Equal(1, LegacyCleanup.RemoveInertDlssTweaksIni(MakeGame()));
    }

    [Fact]
    public void KeepsRealDlssTweaksIni()
    {
        File.WriteAllLines(Path.Combine(_root, "dlsstweaks.ini"), new[]
        {
            "; DLSSTweaks by emoose", "[DLSS]", "ForceDLAA = false", "OverrideAutoExposure = 0",
        });

        Assert.Equal(0, LegacyCleanup.RemoveInertDlssTweaksIni(MakeGame()));
        Assert.True(File.Exists(Path.Combine(_root, "dlsstweaks.ini")));
    }

    [Fact]
    public void KeepsFileWhenDlssTweaksLoaderIsPresent()
    {
        File.WriteAllLines(Path.Combine(_root, "dlsstweaks.ini"), new[] { "[DLSSPresets]", "Global=K" });
        File.WriteAllBytes(Path.Combine(_root, "nvngx.dll"), new byte[] { 1 });

        Assert.Equal(0, LegacyCleanup.RemoveInertDlssTweaksIni(MakeGame()));
    }
}

public class QualityTweakerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public QualityTweakerTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    private Game MakeGame()
    {
        var game = new Game { Name = "Test", InstallDir = _root, Platform = GamePlatform.Manual };
        var dll = Path.Combine(_root, "nvngx_dlssnr.dll");
        File.WriteAllBytes(dll, new byte[] { 1 });
        game.Dlls.Add(new InstalledDll { Kind = DlssDllKind.NeuralRendering, Path = dll });
        return game;
    }

    [Fact]
    public void WritesQualityAndSharpnessToOptiScalerIni()
    {
        File.WriteAllLines(Path.Combine(_root, "OptiScaler.ini"), new[] { "[QualityOverrides]", "QualityRatioOverrideEnabled=false" });

        var result = QualityTweaker.Apply(MakeGame(), QualityMode.Performance, sharpness: 0.3);

        Assert.True(result.Success, result.Message);
        var ini = IniFile.Load(result.ConfigFile!);
        Assert.Equal("true", ini.Get("QualityOverrides", "QualityRatioOverrideEnabled"));
        Assert.Equal("2.0", ini.Get("QualityOverrides", "QualityRatioQuality"));
        Assert.Equal("true", ini.Get("Sharpness", "OverrideSharpness"));
        Assert.Equal("0.3", ini.Get("Sharpness", "Sharpness"));
    }

    [Fact]
    public void GameDefaultDisablesOverride()
    {
        File.WriteAllLines(Path.Combine(_root, "OptiScaler.ini"), new[] { "[QualityOverrides]", "QualityRatioOverrideEnabled=true" });

        var result = QualityTweaker.Apply(MakeGame(), QualityMode.GameDefault);

        Assert.True(result.Success, result.Message);
        Assert.Equal("false", IniFile.Load(result.ConfigFile!).Get("QualityOverrides", "QualityRatioOverrideEnabled"));
    }

    [Fact]
    public void WithoutOptiScalerNothingIsWritten()
    {
        var result = QualityTweaker.Apply(MakeGame(), QualityMode.Quality);

        Assert.False(result.Success);
        Assert.Contains("NVIDIA App", result.Message);
        Assert.False(File.Exists(Path.Combine(_root, "dlsstweaks.ini")));
    }

    [Fact]
    public void RejectsInvalidSharpness()
    {
        Assert.False(QualityTweaker.Apply(MakeGame(), QualityMode.Quality, sharpness: 1.5).Success);
    }
}

public class VersionManifestTests
{
    [Fact]
    public void ParsesRepoManifestAndPicksLatest()
    {
        // Das mitgelieferte Manifest aus dem Repo muss parsebar sein.
        var path = FindRepoFile(Path.Combine("manifest", "dll-manifest.json"));
        var manifest = VersionManifest.Parse(File.ReadAllText(path));

        Assert.NotEmpty(manifest.Dlls);
        var nr = manifest.Latest(DlssDllKind.NeuralRendering);
        Assert.NotNull(nr);
        Assert.Equal("310.9.16.0", nr!.Version);
        Assert.Equal("latest", manifest.Presets["superResolution"].Recommended);
        Assert.Equal("faisalkindi/DLSS5oneclick", manifest.Dlss5OneClick.Repo);
    }

    [Fact]
    public void LatestPrefersHigherVersion()
    {
        var manifest = VersionManifest.Parse("""
            {
              "dlls": [
                { "fileName": "nvngx_dlssnr.dll", "version": "310.8.0.0" },
                { "fileName": "nvngx_dlssnr.dll", "version": "310.9.16.0" }
              ]
            }
            """);

        Assert.Equal("310.9.16.0", manifest.Latest(DlssDllKind.NeuralRendering)!.Version);
    }

    private static string FindRepoFile(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            var candidate = Path.Combine(dir.FullName, relative);
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new FileNotFoundException(relative);
    }
}
