namespace NeuralSwap.Core.Scanning;

/// <summary>
/// Minimaler Parser für Valves KeyValue-Textformat (VDF/ACF), ausreichend für
/// libraryfolders.vdf und appmanifest_*.acf. Verschachtelte Blöcke werden als
/// Pfad mit '/' getrennt abgelegt, z. B. "libraryfolders/0/path".
/// </summary>
public static class VdfParser
{
    public static Dictionary<string, string> Parse(string content)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var stack = new List<string>();
        string? pendingKey = null;

        var i = 0;
        while (i < content.Length)
        {
            var c = content[i];
            if (char.IsWhiteSpace(c)) { i++; continue; }

            if (c == '{')
            {
                if (pendingKey != null) { stack.Add(pendingKey); pendingKey = null; }
                i++;
                continue;
            }
            if (c == '}')
            {
                if (stack.Count > 0) stack.RemoveAt(stack.Count - 1);
                pendingKey = null;
                i++;
                continue;
            }
            if (c == '"')
            {
                var token = ReadQuoted(content, ref i);
                if (pendingKey == null)
                {
                    pendingKey = token;
                }
                else
                {
                    var path = stack.Count == 0 ? pendingKey : string.Join('/', stack) + "/" + pendingKey;
                    result[path] = token;
                    pendingKey = null;
                }
                continue;
            }
            if (c == '/' && i + 1 < content.Length && content[i + 1] == '/')
            {
                while (i < content.Length && content[i] != '\n') i++;
                continue;
            }
            i++; // unbekanntes Zeichen überspringen
        }

        return result;
    }

    private static string ReadQuoted(string content, ref int i)
    {
        i++; // öffnendes "
        var sb = new System.Text.StringBuilder();
        while (i < content.Length && content[i] != '"')
        {
            if (content[i] == '\\' && i + 1 < content.Length)
            {
                i++;
                sb.Append(content[i] switch { 'n' => '\n', 't' => '\t', _ => content[i] });
            }
            else
            {
                sb.Append(content[i]);
            }
            i++;
        }
        i++; // schließendes "
        return sb.ToString();
    }
}
