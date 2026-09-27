// Wake-on-LAN über die FRITZ!Box (TR-064) — Skript für die iPhone-App „Scriptable“.
// Ausweg, falls der Kurzbefehl mit „Inhalte von URL abrufen“ nur 401 zurückbekommt:
// die FRITZ!Box verlangt Digest-Anmeldung, und die rechnet dieses Skript selbst aus.
// Das Passwort liegt im iOS-Schlüsselbund, nicht im Skript.

const CONFIG = {
  // MyFRITZ!-Adresse inkl. HTTPS-Port aus Internet → MyFRITZ!-Konto bzw. Freigaben → FRITZ!Box-Dienste
  host: "https://xxxxxxxxxxxxxxxx.myfritz.net:12345",
  user: "wol",
  mac: "AA:BB:CC:DD:EE:FF",
};

const SERVICE = "urn:dslforum-org:service:Hosts:1";
const ACTION = "X_AVM-DE_WakeOnLANByMACAddress";
const PATH = "/tr064/upnp/control/hosts";

function md5(str) {
  const bytes = unescape(encodeURIComponent(str));
  const n = bytes.length;
  const words = new Array(((n + 8) >> 6) * 16 + 16).fill(0);
  for (let i = 0; i < n; i++) words[i >> 2] |= bytes.charCodeAt(i) << ((i % 4) * 8);
  words[n >> 2] |= 0x80 << ((n % 4) * 8);
  words[(((n + 8) >> 6) + 1) * 16 - 2] = n * 8;
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => (Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let off = 0; off < words.length - 15; off += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const s = S[(i >> 4) * 4 + (i % 4)];
      const sum = (a + f + K[i] + words[off + g]) | 0;
      a = d; d = c; c = b;
      b = (b + ((sum << s) | (sum >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0]
    .map((w) => Array.from({ length: 4 }, (_, i) => ((w >>> (i * 8)) & 0xff).toString(16).padStart(2, "0")).join(""))
    .join("");
}

function parseChallenge(header) {
  const out = {};
  const re = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let m;
  while ((m = re.exec(header))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  return out;
}

function digestHeader({ user, password, method, uri, challenge, cnonce, nc = "00000001" }) {
  const ch = parseChallenge(challenge);
  const ha1 = md5(`${user}:${ch.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = ch.qop && ch.qop.split(",").map((q) => q.trim()).includes("auth") ? "auth" : null;
  const response = qop
    ? md5(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${ch.nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", response="${response}"`;
  if (ch.algorithm) h += `, algorithm=${ch.algorithm}`;
  if (ch.opaque) h += `, opaque="${ch.opaque}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return h;
}

function header(headers, name) {
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

async function post(authorization) {
  const req = new Request(CONFIG.host + PATH);
  req.method = "POST";
  req.timeoutInterval = 15;
  req.headers = {
    "Content-Type": 'text/xml; charset="utf-8"',
    SOAPACTION: `${SERVICE}#${ACTION}`,
    ...(authorization ? { Authorization: authorization } : {}),
  };
  req.body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${ACTION} xmlns:u="${SERVICE}"><NewMACAddress>${CONFIG.mac}</NewMACAddress></u:${ACTION}></s:Body>` +
    "</s:Envelope>";
  const text = await req.loadString();
  return { status: req.response.statusCode, headers: req.response.headers, text };
}

async function password() {
  const key = `fritzbox-wol:${CONFIG.user}`;
  if (Keychain.contains(key)) return Keychain.get(key);
  const alert = new Alert();
  alert.title = "FRITZ!Box-Passwort";
  alert.message = `Kennwort des FRITZ!Box-Benutzers „${CONFIG.user}“. Wird im Schlüsselbund gespeichert.`;
  alert.addSecureTextField("Passwort");
  alert.addAction("Speichern");
  alert.addCancelAction("Abbrechen");
  if ((await alert.presentAlert()) === -1) throw new Error("Abgebrochen");
  const pw = alert.textFieldValue(0);
  Keychain.set(key, pw);
  return pw;
}

async function wake() {
  const first = await post(null);
  if (first.status !== 401) return first;
  const challenge = header(first.headers, "WWW-Authenticate");
  if (!challenge || !/^Digest/i.test(challenge)) return first;
  const cnonce = md5(String(Math.random()) + Date.now()).slice(0, 16);
  const auth = digestHeader({
    user: CONFIG.user, password: await password(), method: "POST", uri: PATH, challenge, cnonce,
  });
  return post(auth);
}

async function main() {
  let msg;
  try {
    const res = await wake();
    if (res.status === 200 && res.text.includes(`${ACTION}Response`)) {
      msg = "Weckruf gesendet — der PC fährt hoch.";
    } else if (res.status === 401) {
      msg = "Anmeldung abgelehnt (401). Benutzer/Passwort oder Rechte prüfen.";
      Keychain.remove(`fritzbox-wol:${CONFIG.user}`);
    } else {
      const fault = (res.text.match(/<errorDescription>([^<]*)</) || [])[1];
      msg = `Fehler ${res.status}${fault ? ": " + fault : ""}`;
    }
  } catch (e) {
    msg = `FRITZ!Box nicht erreichbar: ${e.message || e}`;
  }
  Script.setShortcutOutput(msg);
  if (config.runsInApp) {
    const a = new Alert();
    a.title = "Wake-on-LAN";
    a.message = msg;
    a.addAction("OK");
    await a.present();
  }
  Script.complete();
}

await main();
