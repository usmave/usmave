# NeuralSwap – DLSS 5 Neural-Mods mit einem Klick

Windows-App (C#/.NET 8, WPF), die deine installierten Spiele findet und die
DLSS-DLLs mit einem Klick auf die neueste Version bringt – inklusive
DLSS 5 Neural Rendering (`nvngx_dlssnr.dll`), Preset-Erzwingung und
OptiScaler-Installation für Spiele ohne native DLSS-Unterstützung.

## Features

- **Spiele-Scan**: Steam (alle Bibliotheken, auch auf anderen Laufwerken),
  Epic Games, GOG, Xbox/Game Pass (`XboxGames` auf allen Laufwerken),
  typische Spielordner wie `E:\Games`, `E:\Spiele` oder `D:\Epic Games` auf
  allen festen Laufwerken sowie manuell hinzugefügte Ordner.
- **One-Click-Update**: Tauscht alle gefundenen NGX-DLLs
  (`nvngx_dlss.dll`, `nvngx_dlssg.dll`, `nvngx_dlssd.dll`, `nvngx_dlssnr.dll`)
  gegen die neueste Version aus der lokalen DLL-Bibliothek. Das Original wird
  automatisch gesichert (`*.nsbak`) und ist jederzeit wiederherstellbar.
- **Preset erzwingen**: Setzt das Render-Preset (z. B. **B** = neues
  Neural-Rendering-Modell, **K** = neuestes Super-Resolution-Preset) über die
  `OptiScaler.ini` bzw. `dlsstweaks.ini` des Spiels.
- **OptiScaler-Installation**: Lädt das neueste
  [OptiScaler](https://github.com/optiscaler/OptiScaler)-Release von GitHub
  und installiert es in den Spielordner – für Spiele ohne natives DLSS.
- **Stärke &amp; Schärfe**: Pro Spiel lässt sich die erzwungene Render-Stärke
  (DLAA, Qualität 1,5×, Ausgewogen 1,7×, Performance 2,0×,
  Ultra Performance 3,0×) und die Nachschärfung (0–100 %) setzen – über die
  `OptiScaler.ini` (Sektionen `QualityOverrides`/`Sharpness`) bzw. die
  `dlsstweaks.ini` (`DLSSQualityLevels`/`ForceDLAA`).
- **Versions-Manifest**: `manifest/dll-manifest.json` beschreibt die aktuell
  neuesten DLL-Versionen. Die App kann es auch von einer URL laden
  (Einstellung `manifestUrl`), sodass neue DLSS-Versionen ohne App-Update
  erkannt werden.

## Woher kommen die DLLs?

NVIDIAs DLSS-DLLs dürfen nicht weiterverbreitet werden. Deshalb liefert die
App keine DLLs mit und das Standard-Manifest enthält keine Download-URLs.
Zwei Wege, die Bibliothek zu füllen:

1. **Manuell importieren** („DLL-Bibliothek… → DLL importieren"): die
   `nvngx_dlssnr.dll` z. B. aus einem Spiel kopieren, das die neueste Version
   bereits mitbringt, oder von einer vertrauenswürdigen Quelle
   (TechPowerUp, Nexus Mods) herunterladen.
2. **Eigene Quellen ins Manifest eintragen** (`sources` + `sha256`): dann
   lädt die App die DLL selbst herunter und verifiziert den Hash.

## Bauen

```bash
# Tests (laufen auch unter Linux)
dotnet test neuralswap/tests/NeuralSwap.Core.Tests

# Windows-App (unter Windows)
dotnet publish neuralswap/src/NeuralSwap.App -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

Oder einfach den GitHub-Actions-Workflow **NeuralSwap Build** laufen lassen –
er hängt die fertige `NeuralSwap.exe` als Artefakt `NeuralSwap-win-x64` an.

Die App fordert Administratorrechte an, weil Spiele unter
`C:\Program Files` liegen und die DLLs dort sonst nicht getauscht werden
können.

## Die Mod-Methoden im Überblick

| Methode | Wofür | In der App |
|---|---|---|
| **DLL-Swap** | Spiele mit nativem DLSS: neue `nvngx_*.dll` einsetzen | „Dieses Spiel aktualisieren" / One-Click |
| **Preset-Override** | Neues Neural-Modell aktivieren (Preset B bzw. K) | „Preset erzwingen" (OptiScaler-/DLSSTweaks-Ini) |
| **OptiScaler-Injektion** | Spiele ohne DLSS, FSR/XeSS→DLSS-Bridge, Basis der AMD-Mods | „OptiScaler installieren" |
| **Stärke/Schärfe** | Interne Auflösung und Nachschärfung erzwingen | „Bild-Einstellungen anwenden" |
| **Neural Rendering (Gesichter & Beleuchtung)** | Fotorealistische Gesichter/Licht per DLSS-5-NR-Modell | „Neural Rendering installieren" |
| ReShade/RenoDX-Farbkombos | HDR/Farb-Mods zusätzlich | nicht automatisiert (pro Spiel zu verschieden) |

### Neural Rendering (fotorealistische Gesichter & Beleuchtung)

Die App installiert die Community-Pipeline nach dem Muster der etablierten
Installer, automatisch in der passenden Variante:

- **Pfad A** (Spiel hat natives DLSS): ReShade-Addon `renodx-dlss5.addon64`
  + `nvngx_dlssnr.dll`; Konfiguration in `ReShade.ini`
  (`[RenoDX.DLSS5]` mit `NRHookPoint`, `NRPasses`, `NRDetailStability`).
- **Pfad B** (kein natives DLSS): `dlss5-feed.addon64` + `DLSS5_Feed.fx`
  + LumeniteFX als Motion-Vector-Provider + Shader-Header;
  `ReShade.ini` bekommt `DLSS5_MV_PROVIDER=3`, die Modell-Auflösung steht
  in `dlss5-feed.cfg` (`work_resolution`).

Die Modell-Auflösung (100/75/50 %) ist in der App wählbar – 75 % ist der
übliche Kompromiss für RTX 20/30. **ReShade mit Add-on-Unterstützung** muss
einmalig über den offiziellen Installer (reshade.me) ins Spiel; die App
erkennt das und weist darauf hin. Deinstallation über denselben Knopf.

**Ehrliche Warnung:** Diese Pipeline ist experimentell und stammt aus der
Community, nicht von NVIDIA. Die Quell-Repos stehen im Manifest
(`neuralRendering`) und lassen sich austauschen; die `nvngx_dlssnr.dll`
(RTX 50: Original, RTX 20–40: ShortFuse-Build) besorgst du selbst. Auf
schwächeren Karten kostet der Neural-Pass massiv Leistung, und die Optik
(z. B. veränderte Gesichter) gefällt nicht jedem – Backup/Rollback ist
eingebaut.

**Aktivierung im Spiel:** Nach dem DLL-Swap einfach im Grafikmenü des Spiels
DLSS auswählen – die neue DLL lädt automatisch. Bei OptiScaler öffnet die
**Einfg-Taste** im Spiel ein Overlay-Menü, in dem sich Upscaler, Stärke,
Schärfe und Frame Generation live umstellen lassen; die App setzt dieselben
Werte vorab in der `OptiScaler.ini`.

## Wichtige Hinweise

- **Multiplayer/Anti-Cheat**: DLL-Tausch und erst recht OptiScaler-Injektion
  nur in Singleplayer-Spielen verwenden. In Online-Titeln mit Anti-Cheat
  drohen Sperren.
- **Xbox/Game Pass**: Spiele unter `C:\XboxGames` sind per ACL geschützt.
  Die App entsperrt die betroffenen Dateien bei Bedarf automatisch per
  Besitzübernahme (takeown/icacls, dank Adminrechten). Das funktioniert bei
  vielen, aber nicht bei allen Titeln – und Updates über die Xbox App
  stellen die Originaldateien wieder her, danach einfach erneut den
  One-Click ausführen.
- **Rückgängig machen**: „Originale wiederherstellen" stellt die gesicherte
  DLL wieder her. Auch ein Spiel-Dateicheck (Steam: „Spieldateien
  überprüfen") ersetzt getauschte DLLs durch die Originale.
- **Preset-Hinweis**: Die Preset-Erzwingung greift über OptiScaler bzw.
  DLSSTweaks. Ist keines von beiden im Spiel vorhanden, legt die App eine
  vorbereitete `dlsstweaks.ini` an und weist darauf hin, dass zusätzlich der
  DLSSTweaks-Loader nötig ist – alternativ das Preset in der NVIDIA App
  (Treiber-Override) setzen.

## Aufbau

```
neuralswap/
├── manifest/dll-manifest.json      # Versionskatalog (aktualisierbar)
├── src/NeuralSwap.Core/            # Scan, Swap, Bibliothek, Presets, OptiScaler
├── src/NeuralSwap.App/             # WPF-Oberfläche (deutsch)
└── tests/NeuralSwap.Core.Tests/    # xunit-Tests (24 Tests)
```
