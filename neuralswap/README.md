# NeuralSwap – DLSS 5 mit einem Klick

Windows-App (C#/.NET 8, WPF), die deine installierten Spiele findet, ihre
DLSS-DLLs mit einem Klick auf den neuesten Stand bringt und DLSS 5 Neural
Rendering (fotorealistische Gesichter und Beleuchtung) installiert.

## Funktionen

- **Spiele-Scan**: Steam (alle Bibliotheken, auch auf anderen Laufwerken),
  Epic Games, GOG, Xbox/Game Pass (`XboxGames` auf allen Laufwerken), typische
  Spielordner wie `E:\Games` oder `E:\Spiele` sowie manuell hinzugefügte
  Ordner. Erkannt wird auch die eigentliche Spiel-EXE – bei Unreal-Spielen die
  Shipping-EXE unter `Binaries\Win64` bzw. `Binaries\WinGDK`.
- **One-Click-DLL-Update**: tauscht `nvngx_dlss.dll`, `nvngx_dlssg.dll`,
  `nvngx_dlssd.dll` und `nvngx_dlssnr.dll` gegen die neueste Version der
  Bibliothek – mit Backup (`*.nsbak`), nie als Downgrade.
- **DLL-Ernte**: Bringt ein Spiel per offiziellem Update eine neuere DLL mit
  (z. B. Metro Redux seit dem Next-Gen-Update mit 310.9.16.0), übernimmt der
  Scan sie automatisch in die Bibliothek.
- **Neural Rendering** (Gesichter & Beleuchtung): installieren/aktualisieren,
  Diagnose, „Klappt nicht? Nächstes Setup“, Entfernen – siehe unten.
- **Upscaling-Preset & Stärke/Schärfe**: über die `OptiScaler.ini` des
  Spiels (siehe unten).
- **OptiScaler** für Spiele ohne DLSS: installieren und rückstandslos entfernen.

## Neural Rendering

Die Installation übernimmt **[DLSS5oneclick](https://github.com/faisalkindi/DLSS5oneclick)**
(MIT) über seine Kommandozeile. Es wählt für jedes Spiel selbst das passende
Setup – auf Grundlage zahlreicher Community-Rückmeldungen:

- Spiele mit eigenem DLSS (DX11/DX12): ReShade (Add-on-Version) + Krishs
  `renodx-dlss5`-Add-on + `nvngx_dlssnr.dll`,
- Vulkan-Spiele mit DLSS (z. B. Indiana Jones): OptiScaler-NR-Fork – ReShade
  erreicht Vulkan nicht über eine DLL neben der EXE,
- Spiele ohne DLSS: der DLSS5-Feeder mit LumeniteFX,
- Sonderfälle wie RE-Engine-Spiele (REFramework) oder spielspezifische Setups.

NeuralSwap lädt DLSS5oneclick von GitHub (SHA-256 gegen den von GitHub
veröffentlichten Digest geprüft), zeigt seinen Fortschritt im Protokoll und
merkt sich, ob ReShade vorher schon im Spiel war – **„Entfernen“ nimmt ein
vorhandenes ReShade nie mit**.

Im Spiel: DLSS bzw. DLAA aktivieren, **Pos1** öffnet ReShade → Reiter
**Add-ons** → **DLSS 5 Neural Rendering** → aktivieren; **F6** schaltet es
ein und aus. Bei OptiScaler-Setups öffnet **Einfg** das Menü.

**EnableHooks**: Meldet das Add-on im Spiel „NR braucht die
Streamline-Einstellung … Setze EnableHooks=1“, setzt der Knopf
„🔧 EnableHooks…“ genau diesen Wert in `ReShade.ini` (mit Sicherung). Ohne
diese Meldung bitte nicht setzen: Fehlt der Schlüssel, schaltet das Add-on die
Streamline-Hooks bei Bedarf selbst ein, und ein erzwungenes `1` kann manche
Spiele beim Start abstürzen lassen.

Wichtig: Das neuronale Modell läuft offiziell nur auf **RTX 50**. Nur für
Singleplayer-Spiele verwenden (Anti-Cheat).

## Upscaling-Preset, Stärke und Schärfe

Diese Einstellungen schreibt NeuralSwap in die `OptiScaler.ini` – mit den
Werten, die OptiScaler laut Quelltext erwartet (`RenderPresetForAll` als Zahl:
K = 11, L = 12, M = 13, „Latest“ = 16777215). Die Presets A–F sind in
aktuellen DLSS-DLLs entfernt. **Ohne OptiScaler im Spiel wird nichts
geschrieben**; dann ist der Weg die NVIDIA App (Grafik → Programmeinstellungen
→ DLSS-Override). Das Neural-Rendering-Modell wählt man dagegen im Overlay des
Add-ons, nicht über diese Presets.

Frühere Versionen haben in Spielen ohne Loader wirkungslose `dlsstweaks.ini`
angelegt; der One-Click räumt sie wieder weg.

## Woher kommen die DLLs?

NVIDIAs DLLs werden nicht mitgeliefert. Die Bibliothek füllt sich über die
DLL-Ernte aus deinen Spielen, über manuellen Import („DLL-Bibliothek…“) oder
über eigene Quellen mit SHA-256 im Manifest (`manifest/dll-manifest.json`).

## Tests

- `neuralswap/tests/NeuralSwap.Core.Tests` – Unit-Tests mit realistischen
  Ordnerstrukturen (Unreal auf Steam und Game Pass, SteamLibrary in
  `E:\Games`, NVIDIA-Versionsangaben mit Kommas), selbst erzeugten PE-Dateien
  und einem simulierten GitHub.
- `neuralswap/tests/NeuralSwap.Integration` – läuft in GitHub Actions auf
  Windows gegen die **echten** Downloads: DLSS5oneclick installiert, prüft und
  entfernt in einem Testspiel, OptiScaler wird aus dem echten Release
  installiert; danach muss jeder Spielordner Byte für Byte im
  Ursprungszustand sein. Was nur im laufenden Spiel prüfbar ist (Bild, FPS),
  kann dieser Test nicht abdecken.

## Bauen

```bash
dotnet test neuralswap/tests/NeuralSwap.Core.Tests
dotnet publish neuralswap/src/NeuralSwap.App -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

Die App fordert Administratorrechte an, weil Spiele meist unter
`C:\Program Files` liegen.

## Danke

NeuralSwap automatisiert die Arbeit anderer:
[DLSS5oneclick](https://github.com/faisalkindi/DLSS5oneclick) (faisalkindi),
[ReShade](https://reshade.me) (crosire),
[DLSS5-Feeder](https://github.com/jlrouzies-fr/DLSS5-Feeder) (jlrouzies-fr),
[LumeniteFX](https://github.com/umar-afzaal/LumeniteFX) (Afzaal),
[RenoDX](https://github.com/clshortfuse/renodx) und das renodx-dlss5-Add-on (Krish),
[OptiScaler](https://github.com/optiscaler/OptiScaler) und
[rhi-repo](https://github.com/RankFTW/rhi-repo) (RankFTW).
