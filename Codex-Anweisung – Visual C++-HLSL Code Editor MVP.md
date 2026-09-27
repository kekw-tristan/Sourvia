# Aufgabe

Erstelle einen kleinen, plattformübergreifenden Code-Editor für Windows und Linux.

Das Projekt ist ausdrücklich als **Ein-Tages-MVP** gedacht. Priorisiere eine funktionierende, saubere Minimalversion. Keine unnötigen Abstraktionen, kein Overengineering und keine Features implementieren, die für das MVP nicht erforderlich sind.

## Tech Stack

Verwende:

- Electron
- TypeScript
- React
- Monaco Editor
- React Flow
- Node.js APIs für Filesystem und Child Processes

Das Projekt soll mit möglichst wenigen zusätzlichen Dependencies auskommen.

## Hauptidee

Die wichtigste Besonderheit des Editors ist die Navigation durch das Projekt.

Es soll **keinen klassischen File Explorer als Hauptnavigation** geben.

Stattdessen wird das Dateisystem wie eine Mindmap bzw. ein Graph dargestellt.

Der aktuell ausgewählte Ordner befindet sich im Zentrum.

Seine:

- Dateien
- Unterordner

werden als Nodes darum herum angeordnet und durch Linien mit dem zentralen Ordner verbunden.

Beispiel:

```text
                     renderer.cpp
                          │

gameplay ───────────── [ src ] ───────────── graphics
                          │                       │
                          │                    shaders
                       main.cpp                   │
                                               main.hlsl
```

Wird `graphics` ausgewählt, soll sich die Ansicht entsprechend ändern:

```text
                     camera.cpp
                          │

renderer.cpp ────── [ graphics ] ────── scene
                          │
                          │
                       shaders
                          │
                       main.hlsl
```

## Navigation

Verwende React Flow für den Graphen.

Unterstütze mindestens:

- Panning
- Zoom
- anklickbare Nodes
- Folder Nodes
- File Nodes
- Verbindungslinien zwischen Parent und Child
- automatische Positionierung der Child-Nodes um den aktuellen Ordner

Verwende zunächst ein simples radiales oder halb-radiales Layout.

Keine komplexe Force-Directed-Graph-Engine implementieren.

### Folder

Klick bzw. Doppelklick auf einen Ordner:

- macht diesen Ordner zum neuen Mittelpunkt
- lädt dessen Dateien und Unterordner
- aktualisiert die Graphansicht

Unterstütze außerdem:

- Back Navigation
- Parent Folder Navigation

### File

Klick auf eine Datei:

- öffnet die Datei im Monaco Editor
- erstellt einen Tab, falls die Datei noch nicht geöffnet ist

## Code Editor

Verwende Monaco Editor.

Unterstütze:

- mehrere offene Dateien
- Tabs
- Wechsel zwischen Tabs
- Datei bearbeiten
- Ctrl+S zum Speichern
- Modified-State pro Datei
- grundlegende Syntaxerkennung anhand der Dateiendung

Mindestens:

```text
.cpp
.cc
.cxx
.h
.hpp
.hlsl
.hlsli
.json
.txt
.md
```

Monaco soll den eigentlichen Texteditor übernehmen.

Nicht selbst implementieren:

- Text Rendering
- Cursor
- Selection
- Undo/Redo
- Syntax Highlighting
- Clipboard

## Layout

Erstelle eine einfache zweigeteilte Oberfläche.

Beispiel:

```text
+---------------------------------------------------------+
| File                         Project Name                |
+----------------------------+----------------------------+
|                            |                            |
|      Project Graph         |        Monaco Editor       |
|                            |                            |
|            [src]           | renderer.cpp               |
|           /  |  \          | -------------------------  |
|      game  main graphics   | void Render()              |
|                            | {                          |
|                            |     ...                    |
|                            | }                          |
|                            |                            |
+----------------------------+----------------------------+
| Status                                                   |
+---------------------------------------------------------+
```

Das Design soll modern und dunkel sein, aber Design ist gegenüber Funktionalität zweitrangig.

## Open Folder

Implementiere `Open Folder`.

Der Benutzer soll einen Projektordner auswählen können.

Danach:

1. Projektpfad speichern
2. Root-Verzeichnis einlesen
3. Root als zentralen Graph-Node anzeigen
4. direkte Dateien und Unterordner darstellen

Ignoriere mindestens:

```text
.git
node_modules
bin
bin-int
build
.vs
.idea
```

Die Ignore-Liste soll einfach erweiterbar sein.

## Interne Datenstruktur

Verwende eine einfache Struktur, etwa:

```ts
export interface ProjectNode {
    id: string;
    name: string;
    path: string;
    type: "file" | "folder";
    parentPath?: string;
}
```

Trenne möglichst:

```text
filesystem
graph/navigation
editor documents
language servers
Electron IPC
```

aber vermeide unnötig viele Klassen oder Architektur-Layer.

## Electron Security

Verwende eine saubere Electron-Struktur:

```text
Main Process
    ↓
Preload
    ↓
contextBridge
    ↓
Renderer / React
```

Aktiviere nicht einfach Node Integration im Renderer.

Filesystem-Zugriffe und Prozessstarts sollen über sichere IPC-Aufrufe laufen.

## LSP

Der Editor soll grundsätzlich Language Server unterstützen.

Erstelle dafür eine kleine generische Language-Server-Struktur.

Zielsprachen:

```text
C / C++ → clangd
HLSL    → shader-language-server
```

Die Architektur darf nicht hart auf nur clangd zugeschnitten sein.

Beispiel:

```ts
interface LanguageServerConfig {
    id: string;
    extensions: string[];
    command: string;
    args?: string[];
}
```

Beispielkonfiguration:

```ts
const languageServers = [
    {
        id: "cpp",
        extensions: [".c", ".cpp", ".cc", ".cxx", ".h", ".hpp"],
        command: "clangd"
    },
    {
        id: "hlsl",
        extensions: [".hlsl", ".hlsli"],
        command: "shader-language-server"
    }
];
```

## LSP Priorität

Da es ein Ein-Tages-Projekt ist, implementiere den LSP schrittweise.

### Priorität 1

- Language Server als Child Process starten
- stdin/stdout Kommunikation
- JSON-RPC Message Framing
- `initialize`
- `initialized`
- `textDocument/didOpen`
- `textDocument/didChange`
- `textDocument/didClose`

### Priorität 2

Diagnostics empfangen:

```text
textDocument/publishDiagnostics
```

und in Monaco als Marker anzeigen.

Dadurch sollen Fehler beispielsweise direkt im Editor sichtbar werden.

### Priorität 3

Falls die vorherigen Features stabil laufen:

- Hover
- Go to Definition
- Completion

Nicht versuchen, direkt das vollständige LSP-Protokoll zu implementieren.

## C++ / clangd

Falls im Projekt vorhanden, soll clangd möglichst:

```text
compile_commands.json
```

verwenden.

Der Editor muss keine eigene C++-Analyse durchführen.

Nicht selbst implementieren:

- C++ Parser
- Include Resolver
- AST Parser
- IntelliSense Engine

Dafür ist clangd zuständig.

## HLSL

`.hlsl` und `.hlsli` sollen Monaco als HLSL-Dateien behandeln.

Der HLSL Language Server soll über dieselbe LSP-Abstraktion laufen wie clangd.

Keine eigene Shaderanalyse implementieren.

## Prozessmanagement

Implementiere einen kleinen Process Manager für Language Server.

Er muss:

- Prozesse starten
- stdin schreiben
- stdout lesen
- stderr optional loggen
- Prozesse beim Beenden der Anwendung sauber stoppen

Windows und Linux müssen unterstützt werden.

Verwende nach Möglichkeit Node.js `child_process.spawn`.

## Wichtig: Scope begrenzen

Folgende Features NICHT für das MVP implementieren:

- Debugger
- Git UI
- eigener Terminal Emulator
- Plugin System
- eigener Compiler
- eigener Text Editor
- eigener C++ Parser
- eigener HLSL Parser
- komplexe Settings UI
- Remote Development
- Multiplayer / Collaboration
- AI Assistant
- vollständige VS-Code-Kompatibilität
- komplexes Docking System
- recursive Darstellung des gesamten Projekts gleichzeitig

Der Graph soll immer nur einen sinnvollen lokalen Ausschnitt des Projekts anzeigen.

## UX

Unterstütze möglichst:

```text
Ctrl+O       Open Folder
Ctrl+S       Save
Ctrl+W       Close Tab
Ctrl+Tab     Next Tab
Alt+Left     Previous Folder
Alt+Up       Parent Folder
```

Wenn ein Ordner gewechselt wird, darf eine kurze Animation verwendet werden.

Animationen sind aber keine Priorität.

## Projektstruktur

Halte die Struktur ungefähr so:

```text
src/
├── main/
│   ├── main.ts
│   ├── preload.ts
│   ├── filesystem.ts
│   └── languageServer/
│       ├── LanguageServer.ts
│       ├── LanguageServerManager.ts
│       └── jsonRpc.ts
│
└── renderer/
    ├── App.tsx
    ├── components/
    │   ├── ProjectGraph/
    │   ├── CodeEditor/
    │   └── EditorTabs/
    │
    ├── editor/
    │   └── documentStore.ts
    │
    └── project/
        └── projectStore.ts
```

Du darfst die Struktur vereinfachen, wenn dadurch weniger unnötiger Boilerplate entsteht.

## Arbeitsweise

Arbeite selbstständig.

Treffe vernünftige Entscheidungen, ohne wegen Kleinigkeiten nachzufragen.

Implementiere zuerst den vollständigen vertikalen MVP:

```text
Start application
↓
Open Folder
↓
Graph anzeigen
↓
Ordner navigieren
↓
Datei öffnen
↓
Monaco anzeigen
↓
Datei ändern
↓
Datei speichern
```

Erst wenn dieser Workflow vollständig funktioniert, LSP hinzufügen.

Danach:

```text
clangd starten
↓
Datei öffnen
↓
didOpen
↓
didChange
↓
Diagnostics
↓
Monaco Marker
```

Danach HLSL über dieselbe Struktur integrieren.

## Qualitätsanforderungen

- TypeScript Strict Mode verwenden.
- Keine großen Dateien mit mehreren tausend Zeilen erzeugen.
- Komponenten sinnvoll trennen.
- Keine unnötigen Design Patterns.
- Keine Dummy-Implementierungen als finalen Zustand hinterlassen.
- Fehler sauber behandeln.
- Pfade müssen unter Windows und Linux funktionieren.
- Keine hardcodierten Benutzerpfade.
- Ressourcen beim Beenden sauber freigeben.
- Code möglichst verständlich und direkt halten.

## Definition of Done

Das MVP gilt als fertig, wenn:

1. Die Anwendung unter Windows und Linux gestartet werden kann.
2. Ein Ordner ausgewählt werden kann.
3. Der Ordner als Mindmap/Graph dargestellt wird.
4. In Unterordner navigiert werden kann.
5. Dateien angeklickt und geöffnet werden können.
6. Monaco die Datei anzeigt.
7. Mehrere Tabs funktionieren.
8. Dateien verändert und gespeichert werden können.
9. clangd gestartet werden kann, sofern installiert.
10. C++-Diagnostics von clangd in Monaco dargestellt werden.
11. Die LSP-Architektur grundsätzlich auch HLSL unterstützt.
12. Das Projekt weiterhin klein und nachvollziehbar bleibt.

Der wichtigste Punkt ist:

**Baue keinen VS-Code-Klon. Baue einen kleinen Code-Editor-Prototypen, dessen besonderes Feature die visuelle, Mindmap-artige Navigation durch ein C++/HLSL-Projekt ist.**