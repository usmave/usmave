# PC per Kurzbefehl aufwecken (Wake-on-LAN über die FRITZ!Box)

Ein iPhone-Kurzbefehl schickt der FRITZ!Box über ihre MyFRITZ!-Adresse den Auftrag,
den PC zu wecken. Das ist derselbe Weg, den die Oberfläche der FRITZ!Box mit
**Computer starten** nimmt, nur über die offizielle Schnittstelle **TR-064** statt über
die Weboberfläche. Das funktioniert unterwegs und im WLAN zu Hause, und es geht mit
„Hey Siri, PC an“.

Voraussetzung: Wecken über die FRITZ!Box klappt schon (Heimnetz → Netzwerk → PC →
**Computer starten**). Dann ist am PC alles richtig eingestellt.

## 1. FRITZ!Box vorbereiten (einmalig)

1. **Eigenen Benutzer anlegen**: System → FRITZ!Box-Benutzer → *Benutzer hinzufügen*
   - Name z. B. `wol`, ein **langes Passwort nur aus Buchstaben und Ziffern**
     (Sonderzeichen machen in der Adresse unten Ärger)
   - Häkchen bei **Zugang auch aus dem Internet erlaubt**
   - Recht **FRITZ!Box Einstellungen** (das braucht der Weckbefehl), sonst nichts
2. **Zugriff für Apps erlauben**: Heimnetz → Netzwerk → Netzwerkeinstellungen →
   *Heimnetzfreigaben* → **Zugriff für Anwendungen zulassen** einschalten.
3. **Internetzugriff per HTTPS** muss aktiv sein (Internet → Freigaben →
   *FRITZ!Box-Dienste*, bzw. über das MyFRITZ!-Konto). Dort steht die Adresse mit Port,
   z. B. `https://abcdefghijklmnop.myfritz.net:47123`. Die brauchst du gleich.
4. **MAC-Adresse des PCs** notieren: Heimnetz → Netzwerk → PC → Bearbeiten, z. B.
   `AA:BB:CC:DD:EE:FF`.

## 2. Kurzbefehl bauen

App **Kurzbefehle** → **+** → drei Aktionen hinzufügen:

**① Aktion „Text“** mit genau diesem Inhalt (MAC-Adresse ersetzen):

```xml
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:X_AVM-DE_WakeOnLANByMACAddress xmlns:u="urn:dslforum-org:service:Hosts:1">
<NewMACAddress>AA:BB:CC:DD:EE:FF</NewMACAddress>
</u:X_AVM-DE_WakeOnLANByMACAddress>
</s:Body>
</s:Envelope>
```

**② Aktion „Inhalte von URL abrufen“**

- URL — Benutzer und Passwort stehen vorn in der Adresse, der Pfad ist fest:
  ```
  https://wol:PASSWORT@abcdefghijklmnop.myfritz.net:47123/tr064/upnp/control/hosts
  ```
- Auf den Pfeil tippen, dann:
  - Methode: **POST**
  - Header hinzufügen:
    | Schlüssel | Wert |
    |---|---|
    | `Content-Type` | `text/xml; charset="utf-8"` |
    | `SOAPACTION` | `urn:dslforum-org:service:Hosts:1#X_AVM-DE_WakeOnLANByMACAddress` |
  - Anfragetext: **Datei** → als Datei die Variable **Text** aus ① wählen

**③ Aktion „Wenn“**: *Inhalte von URL* **enthält** `WakeOnLANByMACAddressResponse`
- dann: **Mitteilung anzeigen** „PC wird geweckt“
- sonst: **Mitteilung anzeigen** mit der Variable *Inhalte von URL* (zeigt den Fehler)

Kurzbefehl benennen, z. B. **PC an** — dann reicht „Hey Siri, PC an“. Über das
Teilen-Menü → *Zum Home-Bildschirm* bekommt er ein eigenes Symbol.

> Das Passwort steht im Klartext im Kurzbefehl. Deshalb der eigene Benutzer mit
> möglichst wenig Rechten, und den Kurzbefehl nicht teilen.

## 3. Falls der Kurzbefehl „401“ oder „Unauthorized“ meldet

Die FRITZ!Box verlangt eine *Digest*-Anmeldung. Je nach iOS-Version beantwortet
„Inhalte von URL abrufen“ die mit Benutzer/Passwort aus der Adresse — oder eben nicht.
Wenn nicht, gibt es den Weg über die kostenlose App **Scriptable**, die die Anmeldung
selbst erledigt:

1. **Scriptable** aus dem App Store laden, **+** tippen, den Inhalt von
   [`fritzbox-wol.js`](fritzbox-wol.js) hineinkopieren.
2. Oben im Skript `host`, `user` und `mac` eintragen (ohne Passwort, ohne Pfad).
3. Skript z. B. `PC an` nennen und einmal in Scriptable starten. Es fragt einmalig nach
   dem Passwort und legt es im iOS-Schlüsselbund ab.
4. Im Kurzbefehl stattdessen nur die Aktion **Scriptable → Script ausführen** →
   `PC an` nehmen (Häkchen *Run In App* aus). Die Rückmeldung kommt als Ergebnis des
   Skripts und lässt sich mit **Mitteilung anzeigen** ausgeben.

Wird das Passwort abgelehnt, löscht das Skript es wieder und fragt beim nächsten Start neu.

## Fehlersuche

| Meldung | Ursache |
|---|---|
| `401` / Unauthorized | Benutzer/Passwort falsch, Benutzer ohne *Zugang aus dem Internet*, oder das Digest-Problem oben → Scriptable |
| `606` / Action not authorized | Benutzer hat das Recht *FRITZ!Box Einstellungen* nicht |
| `404` | Pfad falsch oder *Zugriff für Anwendungen zulassen* ist aus |
| Zeitüberschreitung / nicht erreichbar | Adresse oder Port falsch, HTTPS-Internetzugriff aus |
| Erfolg gemeldet, PC bleibt aus | MAC-Adresse prüfen; testweise *Computer starten* in der FRITZ!Box |

Vom Computer aus lässt sich der Aufruf so prüfen (Werte ersetzen):

```bash
curl --digest -u 'wol:PASSWORT' \
  -H 'Content-Type: text/xml; charset="utf-8"' \
  -H 'SOAPACTION: urn:dslforum-org:service:Hosts:1#X_AVM-DE_WakeOnLANByMACAddress' \
  -d '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:X_AVM-DE_WakeOnLANByMACAddress xmlns:u="urn:dslforum-org:service:Hosts:1"><NewMACAddress>AA:BB:CC:DD:EE:FF</NewMACAddress></u:X_AVM-DE_WakeOnLANByMACAddress></s:Body></s:Envelope>' \
  https://abcdefghijklmnop.myfritz.net:47123/tr064/upnp/control/hosts
```

Kommt dabei `X_AVM-DE_WakeOnLANByMACAddressResponse` zurück, stimmen FRITZ!Box,
Benutzer und MAC — dann liegt ein Problem nur noch am iPhone-Teil.
