# Öl-Check

Web-App zum Erfassen von Öl- und Kühlmittel-Nachfüllungen, Ölwechseln und dem Ölverbrauch pro 1.000 Kilometer.

## Start mit Docker Compose

```yaml
services:
  oil-tracker:
    image: ghcr.io/gedankenstrom/oel-check:latest
    container_name: oil-tracker
    restart: unless-stopped
    ports:
      - "9090:3000"
    environment:
      PORT: 3000
      AUTH_USERNAME: ${AUTH_USERNAME}
      AUTH_PASSWORD: ${AUTH_PASSWORD}
      SESSION_SECRET: ${SESSION_SECRET}
      SESSION_COOKIE_SECURE: ${SESSION_COOKIE_SECURE:-false}
    volumes:
      - oil_data:/app/data

volumes:
  oil_data:
```

Die Seite ist anschließend unter `http://<server-ip>:9090` erreichbar. Die Einträge liegen dauerhaft im Docker-Volume `oil_data`.

### Anmeldung einrichten

Lege in Portainer unter den Stack-Umgebungsvariablen diese Werte fest:

- `AUTH_USERNAME`: gewünschter Benutzername
- `AUTH_PASSWORD`: ein langes, eigenes Passwort
- `SESSION_SECRET`: zufälliger Schlüssel mit mindestens 32 Zeichen
- `SESSION_COOKIE_SECURE`: `false` bei direktem HTTP-Zugriff; `true`, wenn die Seite ausschließlich über HTTPS erreichbar ist

Nach dem Stack-Start schützt die Anmeldung alle API-Endpunkte einschließlich der gespeicherten Fahrzeugdaten. Die Sitzung läuft nach acht Stunden ab. Nach zehn falschen Anmeldeversuchen von derselben Adresse werden weitere Versuche für 15 Minuten abgewiesen.

## Lokal starten

```sh
npm install
npm start
```

## Datenschutz und Zugriff

Fahrzeugdaten gehören in das Docker-Volume und nicht in GitHub. Das Volume wird beim ersten Start automatisch mit einer leeren Datendatei angelegt. Sichern und übertragen lassen sich die Daten durch eine Sicherung des Volumes.

Bei direktem HTTP-Zugriff werden Zugangsdaten und Sitzung nicht verschlüsselt übertragen. Für den Zugriff über das Internet muss die Verbindung über HTTPS laufen.
