namespace NeuralSwap.Core.Presets;

/// <summary>
/// Sehr einfacher INI-Editor, der bestehende Dateien zeilenweise erhält und
/// nur die gewünschten Schlüssel setzt bzw. ergänzt.
/// </summary>
public sealed class IniFile
{
    private readonly List<string> _lines;

    public IniFile(IEnumerable<string>? lines = null)
    {
        _lines = lines?.ToList() ?? new List<string>();
    }

    public static IniFile Load(string path) =>
        File.Exists(path) ? new IniFile(File.ReadAllLines(path)) : new IniFile();

    public void Save(string path) => File.WriteAllLines(path, _lines);

    public string? Get(string section, string key)
    {
        var (start, end) = SectionRange(section);
        if (start < 0) return null;
        for (var i = start + 1; i < end; i++)
        {
            if (TryParseKey(_lines[i], out var k, out var v) &&
                k.Equals(key, StringComparison.OrdinalIgnoreCase))
                return v;
        }
        return null;
    }

    public void Set(string section, string key, string value)
    {
        var (start, end) = SectionRange(section);
        if (start < 0)
        {
            if (_lines.Count > 0 && !string.IsNullOrWhiteSpace(_lines[^1])) _lines.Add(string.Empty);
            _lines.Add($"[{section}]");
            _lines.Add($"{key}={value}");
            return;
        }

        for (var i = start + 1; i < end; i++)
        {
            if (TryParseKey(_lines[i], out var k, out _) &&
                k.Equals(key, StringComparison.OrdinalIgnoreCase))
            {
                _lines[i] = $"{key}={value}";
                return;
            }
        }
        _lines.Insert(end, $"{key}={value}");
    }

    /// <summary>Entfernt einen Schlüssel; die Sektion bleibt bestehen.</summary>
    public bool Remove(string section, string key)
    {
        var (start, end) = SectionRange(section);
        if (start < 0) return false;
        for (var i = start + 1; i < end; i++)
        {
            if (TryParseKey(_lines[i], out var k, out _) &&
                k.Equals(key, StringComparison.OrdinalIgnoreCase))
            {
                _lines.RemoveAt(i);
                return true;
            }
        }
        return false;
    }

    /// <summary>(Index der Sektionszeile, Index hinter dem letzten Sektionsinhalt).</summary>
    private (int start, int end) SectionRange(string section)
    {
        var start = -1;
        for (var i = 0; i < _lines.Count; i++)
        {
            var line = _lines[i].Trim();
            if (line.StartsWith('[') && line.EndsWith(']'))
            {
                if (start >= 0) return (start, i);
                if (line[1..^1].Trim().Equals(section, StringComparison.OrdinalIgnoreCase))
                    start = i;
            }
        }
        return start >= 0 ? (start, _lines.Count) : (-1, -1);
    }

    private static bool TryParseKey(string line, out string key, out string value)
    {
        key = value = string.Empty;
        var trimmed = line.Trim();
        if (trimmed.StartsWith(';') || trimmed.StartsWith('#') || trimmed.StartsWith('[')) return false;
        var eq = trimmed.IndexOf('=');
        if (eq <= 0) return false;
        key = trimmed[..eq].Trim();
        value = trimmed[(eq + 1)..].Trim();
        return true;
    }
}
