# PC per Kurzbefehl aufwecken (Wake-on-LAN über die FRITZ!Box)

Ein iPhone-Kurzbefehl schickt der FRITZ!Box den Auftrag, den PC zu wecken. Das ist
derselbe Weg, den die Oberfläche der FRITZ!Box mit **Computer starten** nimmt, nur über
die offizielle Schnittstelle **TR-064** statt über die Weboberfläche. Es geht auch mit
„Hey Siri, PC an“.

Voraussetzung: Wecken über die FRITZ!Box klappt schon (Heimnetz → Netzwerk → PC →
**Computer starten**). Dann ist am PC alles richtig eingestellt.

Alle Werte unten sind Beispiele (MAC `AA:BB:CC:DD:EE:FF`, Adressen, Benutzer `wol`) und
müssen durch die eigenen ersetzt werden. Echte Daten gehören nicht hierher, das Repo ist
öffentlich.

## 1. FRITZ!Box vorbereiten (einmalig)

1. **Eigenen Benutzer anlegen**: System → FRITZ!Box-Benutzer → *Benutzer hinzufügen*
   - Name z. B. `wol`, ein **langes Passwort nur aus Buchstaben und Ziffern**
     (Sonderzeichen machen in der Adresse unten Ärger)
   - Recht **FRITZ!Box Einstellungen** (das braucht der Weckbefehl), sonst nichts
   - nur für unterwegs ohne VPN: Häkchen bei **Zugang auch aus dem Internet erlaubt**
2. **Zugriff für Apps erlauben**: Heimnetz → Netzwerk → Netzwerkeinstellungen →
   *Heimnetzfreigaben* → **Zugriff für Anwendungen zulassen** einschalten.
3. **MAC-Adresse des PCs** notieren: Heimnetz → Netzwerk, beim PC unter *MAC-Adresse*.
4. **Adresse der FRITZ!Box**, je nachdem, wo der Kurzbefehl laufen soll:
   - *zu Hause im WLAN* oder *unterwegs über das VPN der FRITZ!Box* (WireGuard): die
     IP-Adresse, mit der du die FRITZ!Box im Browser öffnest (ab Werk `192.168.178.1`).
     Mehr braucht es nicht, auch keinen Internetzugriff auf die FRITZ!Box. Unterwegs
     verbindet der Kurzbefehl vorher das VPN (siehe [unten](#unterwegs-per-vpn)).
   - *unterwegs ohne VPN*: die MyFRITZ!-Adresse mit HTTPS-Port, z. B.
     `abcdefghijklmnop.myfritz.net:47123` (Internet → MyFRITZ!-Konto bzw. Internet →
     Freigaben → *FRITZ!Box-Dienste*; der Internetzugriff per HTTPS muss dort an sein).

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

- URL: Benutzer und Passwort stehen vorn in der Adresse. Zu Hause und per VPN geht es
  über Port `49000` ohne `/tr064`, ohne VPN über die MyFRITZ!-Adresse mit `/tr064`:
  ```
  http://wol:PASSWORT@192.168.178.1:49000/upnp/control/hosts
  ```
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

### Unterwegs per VPN

Ist das VPN der FRITZ!Box (WireGuard) auf dem iPhone eingerichtet, kommt als **erste**
Aktion **VPN festlegen** dazu (in der Aktionssuche „VPN“ eingeben): *Verbinden* und den
Tunnel auswählen. Danach gilt die Heimnetz-Adresse wie zu Hause. Der Tunnel bleibt
anschließend verbunden, für den Zugriff auf den geweckten PC.

> Das Passwort steht im Klartext im Kurzbefehl. Deshalb der eigene Benutzer mit
> möglichst wenig Rechten, und den Kurzbefehl nicht teilen.

## 3. Falls der Kurzbefehl „401“ oder „Unauthorized“ meldet

Die FRITZ!Box verlangt eine *Digest*-Anmeldung. Je nach iOS-Version beantwortet
„Inhalte von URL abrufen“ die mit Benutzer/Passwort aus der Adresse — oder eben nicht.
Wenn nicht, gibt es den Weg über die kostenlose App **Scriptable**, die die Anmeldung
selbst erledigt:

1. **Scriptable** aus dem App Store laden, **+** tippen, den Inhalt von
   [`fritzbox-wol.js`](fritzbox-wol.js) hineinkopieren.
2. Oben im Skript `url`, `user` und `mac` eintragen. `url` ist dieselbe Adresse wie im
   Kurzbefehl, nur **ohne** `wol:PASSWORT@`.
3. Skript z. B. `PC an` nennen und einmal in Scriptable starten. Es fragt einmalig nach
   dem Passwort und legt es im iOS-Schlüsselbund ab. Fragt iOS, ob Scriptable auf
   Geräte im lokalen Netzwerk zugreifen darf: erlauben.
4. Im Kurzbefehl stattdessen die Scriptable-Aktion **Run Script** mit dem Skript
   `PC an` nehmen (*Run In App* aus), unterwegs davor **VPN festlegen** wie oben. Die
   Rückmeldung kommt als Ergebnis des Skripts und lässt sich mit **Mitteilung
   anzeigen** ausgeben. Steht der Tunnel noch nicht, versucht das Skript es einige
   Sekunden lang weiter.

Wird das Passwort abgelehnt, löscht das Skript es wieder und fragt beim nächsten Start neu.

## Fehlersuche

| Meldung | Ursache |
|---|---|
| `401` / Unauthorized | Benutzer/Passwort falsch, Benutzer ohne *Zugang aus dem Internet*, oder das Digest-Problem oben → Scriptable |
| `606` / Action not authorized | Benutzer hat das Recht *FRITZ!Box Einstellungen* nicht |
| `404` | Pfad falsch (zu Hause ohne `/tr064`, unterwegs mit) |
| Zeitüberschreitung / nicht erreichbar | zu Hause: IP falsch, iPhone nicht im WLAN oder *Zugriff für Anwendungen zulassen* aus; per VPN: Tunnel nicht verbunden; ohne VPN: Adresse/Port falsch oder HTTPS-Internetzugriff aus |
| Erfolg gemeldet, PC bleibt aus | MAC-Adresse prüfen; testweise *Computer starten* in der FRITZ!Box |

Vom Computer aus lässt sich der Aufruf so prüfen (Werte ersetzen, als Adresse geht auch
die fürs Heimnetz):

```bash
curl --digest -u 'wol:PASSWORT' \
  -H 'Content-Type: text/xml; charset="utf-8"' \
  -H 'SOAPACTION: urn:dslforum-org:service:Hosts:1#X_AVM-DE_WakeOnLANByMACAddress' \
  -d '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:X_AVM-DE_WakeOnLANByMACAddress xmlns:u="urn:dslforum-org:service:Hosts:1"><NewMACAddress>AA:BB:CC:DD:EE:FF</NewMACAddress></u:X_AVM-DE_WakeOnLANByMACAddress></s:Body></s:Envelope>' \
  https://abcdefghijklmnop.myfritz.net:47123/tr064/upnp/control/hosts
```

Kommt dabei `X_AVM-DE_WakeOnLANByMACAddressResponse` zurück, stimmen FRITZ!Box,
Benutzer und MAC — dann liegt ein Problem nur noch am iPhone-Teil.
