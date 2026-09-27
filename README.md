# Sourvia

Ein kleiner Electron-Editor für Windows und Linux. Das Projekt wird als lokale
Mindmap navigiert: Der aktuelle Ordner liegt im Zentrum, seine direkten Dateien
und Unterordner liegen darum herum. Monaco übernimmt den Texteditor.

## Starten

Voraussetzung: Node.js **22.12 oder neuer** und npm. Linux benötigt eine grafische
Desktop-Sitzung und die üblichen Electron-Systembibliotheken (GTK, NSS, ALSA).

```sh
npm install
npm run dev
```

React-Änderungen werden im Entwicklungsmodus automatisch aktualisiert.
Nach Änderungen an Main oder Preload den Entwicklungsprozess neu starten.

Produktionsbuild und Start:

```sh
npm run build
npm start
```

Electron und Monaco werden lokal installiert; der Editor benötigt zur Laufzeit
keinen CDN-Zugriff. Der MVP enthält noch keinen Installer.

## Bedienung

1. **Open folder** wählen und einen Projektordner auswählen.
2. Ordner im Graphen anklicken, um sie zum Mittelpunkt zu machen.
3. Dateien anklicken, bearbeiten und mit **Ctrl+S** speichern.
4. Mausrad zum Zoomen und freie Fläche zum Verschieben des Graphen verwenden.

| Tastenkürzel | Aktion |
| --- | --- |
| Ctrl+O | Projektordner öffnen |
| Ctrl+S | Aktive Datei speichern |
| Ctrl+W | Aktiven Tab schließen |
| Ctrl+Tab / Ctrl+Shift+Tab | Nächster / vorheriger Tab |
| Alt+Left | Vorheriger Ordner |
| Alt+Up | Übergeordneter Ordner innerhalb des Projekts |

Tabs behalten Text, Undo-Historie und Scrollposition. Ungespeicherte Änderungen
sind mit einem Punkt markiert. Tab- und Projektwechsel fragen nach Speichern,
Verwerfen oder Abbrechen. Beim Beenden kann man abbrechen und zunächst speichern.
Extern veränderte Dateien werden beim Speichern nicht still überschrieben.

Unterstützt werden UTF-8-Textdateien bis 8 MiB. Binärdateien und UTF-16 werden
abgewiesen. Symlinks werden im Graphen ausgelassen. Dateizugriffe bleiben auf den
ausgewählten Projektordner beschränkt. Ignorierte Namen stehen zentral in
`src/main/filesystem.ts` (`ignoredNames`). Kein Dateiwatcher: Einen Ordner erneut
besuchen, um externe Änderungen der Verzeichnisstruktur einzulesen.

## Language Server

Die Server werden separat installiert und bei der ersten passenden Datei
automatisch gestartet. Fehlt ein Server, bleiben Navigation und Bearbeitung
verfügbar; die Statusleiste zeigt `unavailable`, der Tooltip die Ursache.
Nach einer Installation oder einem Serverfehler den Projektordner erneut öffnen.

| Dateien | Programm auf PATH | Optionaler Pfad über Umgebungsvariable |
| --- | --- | --- |
| `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hxx` | `clangd` | `SOURVIA_CLANGD` |
| `.hlsl`, `.hlsli` | `shader-language-server` | `SOURVIA_HLSL_SERVER` |

Die Variablen enthalten den Pfad zur ausführbaren Datei, ohne eingebettete
Argumente oder zusätzliche Anführungszeichen. Weitere Server und Argumente können
in `src/main/languageServer/config.ts` ergänzt werden. Der HLSL-Server wird mit
`--stdio --hlsl` gestartet; für andere Distributionen dort die Argumente anpassen.

[clangd](https://clangd.llvm.org/installation) verwendet eine vorhandene
`compile_commands.json` in übergeordneten Ordnern beziehungsweise `build/`.
Bei CMake lässt sie sich mit `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` zusammen mit
Ninja oder Unix Makefiles erzeugen. Abweichende Build-Verzeichnisse können über
die [clangd-Konfiguration](https://clangd.llvm.org/config.html) angegeben werden.
Der Graph ignoriert `build/`; clangd kann die Compilation Database trotzdem lesen.

Als HLSL-Server eignet sich der
[shader-language-server aus shader-sense](https://github.com/antaalt/shader-sense).
HLSL erhält eine eigene Monaco-Sprach-ID und verwendet Monacos mitgelieferten
C++-Lexer für die grundlegende C-artige Syntax. Semantische Diagnostics liefert
der externe Server; Sourvia implementiert keine eigene Shaderanalyse.

Implementiert: stdin/stdout mit UTF-8-Content-Length-Framing, Initialize-Lifecycle,
DidOpen/DidChange/DidSave/DidClose, volle und inkrementelle Synchronisierung,
Diagnostics als Monaco-Marker sowie Shutdown mit Zeitlimit und Prozessabbruch.
Hover, Definition und LSP-Completion sind entsprechend der MVP-Priorisierung
noch nicht enthalten.

## Prüfen

```sh
npm run typecheck
npm test
npm run build
npm run test:electron
```

Der Electron-Smoke-Test startet ein verborgenes echtes Fenster, verwendet einen
temporären Projektordner und prüft Graphnavigation, Monaco, Tabwechsel, Bearbeiten,
Speichern, Schutz ungespeicherter Änderungen und LSP-Marker. Der Protokollserver
in `tests/fixtures` ist ausschließlich ein Testwerkzeug, kein Ersatzserver der App.
Auf einem Linux-CI ohne Display kann `xvfb-run -a npm run test:electron` verwendet
werden. Echte clangd-Diagnostics lassen sich optional mit `npm run test:clangd`
prüfen; dafür muss clangd installiert oder `SOURVIA_CLANGD` gesetzt sein.

## Struktur

- `src/main/filesystem.ts`: Projektgrenzen, Verzeichnislesen, Lesen/Speichern.
- `src/main/main.ts`, `preload.ts`: Fenster, Dialoge und begrenzte IPC-API.
- `src/main/languageServer/`: generischer LSP-Transport und Prozessverwaltung.
- `src/renderer/components/`: Graph, Tabs und Monaco-Anbindung.
- `src/renderer/editor/`: Dokumentzustand und Monaco-Konfiguration.
- `src/shared/`: gemeinsame Typen und Dateiendungen.

Der Renderer läuft mit Context Isolation und Sandbox, ohne Node Integration.
IPC prüft den aufrufenden Frame. Neue Fenster, externe Navigation und
Berechtigungsanfragen sind deaktiviert. Serverbefehle kommen aus der Anwendung
oder der Startumgebung, niemals aus geöffneten Projektdateien.

Technische Grundlagen:
[Electron-Sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox),
[React Flow](https://reactflow.dev/api-reference/react-flow),
[Language Server Protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/).
