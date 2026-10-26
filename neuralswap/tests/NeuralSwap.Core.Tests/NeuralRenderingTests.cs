using System.Text.Json;
using NeuralSwap.Core.Library;
using NeuralSwap.Core.NeuralRendering;
using NeuralSwap.Core.Presets;
using Xunit;

namespace NeuralSwap.Core.Tests;

public class NeuralRenderingConfigTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public NeuralRenderingConfigTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void RouteAWritesRenoDxSection()
    {
        NeuralRenderingInstaller.ApplyConfigs(_root, routeA: true, new NrOptions { WorkingScalePercent = 75 });

        var ini = IniFile.Load(Path.Combine(_root, "ReShade.ini"));
        Assert.Equal("1", ini.Get("RenoDX.DLSS5", "NRHookPoint"));
        Assert.Equal("1", ini.Get("RenoDX.DLSS5", "NRPasses"));
        Assert.Equal("2", ini.Get("RenoDX.DLSS5", "NRDetailStability"));
    }

    [Fact]
    public void RouteBMergesPreprocessorDefinitionsAndWritesFeedConfig()
    {
        File.WriteAllLines(Path.Combine(_root, "ReShade.ini"),
            new[] { "[GENERAL]", "PreprocessorDefinitions=FOO=1" });

        NeuralRenderingInstaller.ApplyConfigs(_root, routeA: false, new NrOptions { WorkingScalePercent = 50 });

        var ini = IniFile.Load(Path.Combine(_root, "ReShade.ini"));
        Assert.Equal("FOO=1,DLSS5_MV_PROVIDER=3", ini.Get("GENERAL", "PreprocessorDefinitions"));

        var cfg = File.ReadAllLines(Path.Combine(_root, "dlss5-feed.cfg"));
        Assert.Contains("work_resolution=0.5", cfg);

        var preset = File.ReadAllText(Path.Combine(_root, "ReShadePreset.ini"));
        Assert.Contains("Lumenite_Kernel", preset);
        Assert.Contains("DLSS5_Feed", preset);
    }

    [Fact]
    public void RouteBDoesNotDuplicateProviderOrTechniques()
    {
        File.WriteAllLines(Path.Combine(_root, "ReShade.ini"),
            new[] { "[GENERAL]", "PreprocessorDefinitions=DLSS5_MV_PROVIDER=3" });
        File.WriteAllLines(Path.Combine(_root, "ReShadePreset.ini"),
            new[] { "Techniques=Lumenite_Kernel,DLSS5_Feed" });

        NeuralRenderingInstaller.ApplyConfigs(_root, routeA: false, new NrOptions());

        var ini = IniFile.Load(Path.Combine(_root, "ReShade.ini"));
        Assert.Equal("DLSS5_MV_PROVIDER=3", ini.Get("GENERAL", "PreprocessorDefinitions"));
        var techniqueLines = File.ReadAllLines(Path.Combine(_root, "ReShadePreset.ini"))
            .Count(l => l.StartsWith("Techniques=", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(1, techniqueLines);
    }

    [Fact]
    public void SetsOptiScalerWorkingScaleWhenPresent()
    {
        File.WriteAllLines(Path.Combine(_root, "OptiScaler.ini"), new[] { "[Upscalers]", "Dx12Upscaler=auto" });

        NeuralRenderingInstaller.ApplyConfigs(_root, routeA: true, new NrOptions { WorkingScalePercent = 100 });

        Assert.Equal("1.0", IniFile.Load(Path.Combine(_root, "OptiScaler.ini")).Get("DlssNr", "WorkingScale"));
    }

    [Fact]
    public void UninstallRemovesRecordedFiles()
    {
        var addon = Path.Combine(_root, "dlss5-feed.addon64");
        File.WriteAllBytes(addon, new byte[] { 1 });
        File.WriteAllText(Path.Combine(_root, NeuralRenderingInstaller.StateFileName),
            JsonSerializer.Serialize(new[] { addon }));

        Assert.True(NeuralRenderingInstaller.IsInstalled(_root));
        var result = NeuralRenderingInstaller.Uninstall(_root);

        Assert.True(result.Success, result.Message);
        Assert.False(File.Exists(addon));
        Assert.False(NeuralRenderingInstaller.IsInstalled(_root));
    }

    [Fact]
    public void PickReleaseIndexPrefersFirstPrefixAcrossTags()
    {
        // Reale Tag-Struktur des rhi-repo (neueste zuerst): kein renodx-dlss5-Tag,
        // aber renodx-dlss-SF-* → zweites Präfix muss greifen.
        var tags = new[]
        {
            "streamline-2.14.16.0-v2",
            "renodx-dlss-SF-26.1016.1304",
            "dlssnr-310.9.16",
            "renodx-dlss-SF-26.1003.2350",
        };
        var prefixes = new[] { "renodx-dlss5", "renodx-dlss" };

        Assert.Equal(1, NeuralRenderingInstaller.PickReleaseIndex(tags, prefixes));
    }

    [Fact]
    public void PickReleaseIndexEmptyPrefixTakesNewest()
    {
        Assert.Equal(0, NeuralRenderingInstaller.PickReleaseIndex(new[] { "v2.1", "v2.0" }, new[] { "" }));
        Assert.Equal(-1, NeuralRenderingInstaller.PickReleaseIndex(new[] { "v2.1" }, new[] { "foo" }));
    }

    [Fact]
    public void PickAssetNamePrefersAddonOverHashes()
    {
        var names = new[] { "checksums.sha256", "readme.txt", "renodx-dlss.addon64" };
        Assert.Equal("renodx-dlss.addon64", NeuralRenderingInstaller.PickAssetName(names));

        Assert.Equal("feeder.zip", NeuralRenderingInstaller.PickAssetName(new[] { "notes.md", "feeder.zip" }));
        Assert.Equal("some.dll", NeuralRenderingInstaller.PickAssetName(new[] { "info.txt", "some.dll" }));
    }

    [Fact]
    public void RouteBSetsShaderSearchPathsOnlyWhenMissing()
    {
        File.WriteAllLines(Path.Combine(_root, "ReShade.ini"),
            new[] { "[GENERAL]", @"EffectSearchPaths=D:\MeineShader" });

        NeuralRenderingInstaller.ApplyConfigs(_root, routeA: false, new NrOptions());

        var ini = IniFile.Load(Path.Combine(_root, "ReShade.ini"));
        Assert.Equal(@"D:\MeineShader", ini.Get("GENERAL", "EffectSearchPaths")); // nicht überschrieben
        Assert.Equal(@".\reshade-shaders\Textures", ini.Get("GENERAL", "TextureSearchPaths"));
    }

    [Fact]
    public void ManifestParsesNeuralRenderingSources()
    {
        var manifest = VersionManifest.Parse("""
            { "neuralRendering": { "feederRepo": "foo/bar", "lumeniteBranch": "dev" } }
            """);

        Assert.Equal("foo/bar", manifest.NeuralRendering.FeederRepo);
        Assert.Equal("dev", manifest.NeuralRendering.LumeniteBranch);
        Assert.Equal("crosire/reshade-shaders", manifest.NeuralRendering.ShadersRepo);
    }
}
