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
    volumes:
      - oil_data:/app/data

volumes:
  oil_data:
```

Die Seite ist anschließend unter `http://<server-ip>:9090` erreichbar. Die Einträge liegen dauerhaft im Docker-Volume `oil_data`.

## Lokal starten

```sh
npm install
npm start
```

## Datenschutz und Zugriff

Fahrzeugdaten gehören in das Docker-Volume und nicht in GitHub. Das Volume wird beim ersten Start automatisch mit einer leeren Datendatei angelegt. Sichern und übertragen lassen sich die Daten durch eine Sicherung des Volumes.

Die API hat derzeit keine Anmeldung. Betreibe die App daher nur in einem vertrauenswürdigen Heimnetz und veröffentliche Port 3000 nicht direkt im Internet.
