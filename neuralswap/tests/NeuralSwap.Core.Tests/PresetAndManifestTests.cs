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

    [Fact]
    public void UsesOptiScalerIniWhenPresent()
    {
        File.WriteAllLines(Path.Combine(_root, "OptiScaler.ini"), new[] { "[Dlss]", "RenderPresetOverride=false" });

        var result = PresetForcer.Force(MakeGame(), "b");

        Assert.True(result.Success, result.Message);
        var ini = IniFile.Load(result.ConfigFile!);
        Assert.Equal("true", ini.Get("Dlss", "RenderPresetOverride"));
        Assert.Equal("B", ini.Get("Dlss", "RenderPresetForAll"));
    }

    [Fact]
    public void CreatesDlssTweaksIniAsFallback()
    {
        var result = PresetForcer.Force(MakeGame(), "B");

        Assert.True(result.Success, result.Message);
        Assert.EndsWith("dlsstweaks.ini", result.ConfigFile);
        Assert.Equal("B", IniFile.Load(result.ConfigFile!).Get("DLSSPresets", "Global"));
        Assert.Contains("DLSSTweaks", result.Message); // Hinweis auf fehlenden Loader
    }

    [Fact]
    public void RejectsUnknownPreset()
    {
        Assert.False(PresetForcer.Force(MakeGame(), "Z").Success);
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
        Assert.Equal("B", manifest.Presets["neuralRendering"].Recommended);
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
