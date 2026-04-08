# Architecture

## Core Principle

Vault = schema + data. Schema is defined in the vault itself via entity and property files. The validator invents nothing — all rules come from YAML frontmatter.

**Entity** = structure (which fields, required/optional, allow_extra)
**Property** = validation (type, constraints, link targets, custom JS)

Dependency is one-way: entity -> property. Properties know nothing about entities.

## Module Structure

```
src/
  # Core library (runtime-agnostic, no file I/O)
  types.ts                    # All types: RawFile, VaultSchema, ValidateOptions, etc.
  schema.ts                   # Parse entity/property files -> entityMap + Zod + inheritance
  validate.ts                 # Three-level validation + link constraints + custom JS
  index.ts                    # Library entry point (re-exports)
  cli.ts                      # CLI entry point (only module with fs access)
  config.ts                   # CLI config resolution

  # Obsidian plugin
  plugin-main.ts              # Plugin class: commands, ribbon, status bar, events
  bridge.ts                   # TFile <-> RawFile adapter, vault index, file writes
  constants.ts                # Settings interface, defaults
  SettingsTab.ts              # Tabbed settings UI (Settings, Entities, Properties)
  ResultsView.ts              # Validation results panel (ItemView)
  ui/
    TabManager.ts             # Generic tab navigation component
    EntitiesTab.ts            # Entity CRUD UI with inheritance
    PropertiesTab.ts          # Property CRUD UI with link constraints
    yamlWriter.ts             # YAML frontmatter serializer
    empty-fs.ts               # fs shim for gray-matter in browser

# Root (official Obsidian plugin layout)
manifest.json                 # Plugin manifest
styles.css                    # Plugin styles
esbuild.config.mjs            # Build config
```

## Two Consumers, One Core

```
                    ┌─────────────────┐
                    │   Core Library   │
                    │ schema.ts        │
                    │ validate.ts      │
                    │ types.ts         │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──────┐  ┌───▼──────┐  ┌───▼──────────┐
     │   CLI          │  │ Plugin   │  │ Future       │
     │ cli.ts         │  │ bridge.ts│  │ integrations │
     │ fs.readFile()  │  │ cachedRead│  │              │
     └───────────────┘  └──────────┘  └──────────────┘
```

Core accepts `RawFile[] = { path: string, content: string }[]` — who reads the files is irrelevant. CLI uses `fs`, plugin uses Obsidian Vault API.

## Entity Inheritance

Entities support single inheritance via `extends`. The schema loader resolves the full chain and merges properties (parent first, child overrides). Circular dependencies are detected at load time.

```
base → trackable → structure → task
                              → epic
                              → area
       trackable → rhythm    → day
                              → sprint
       trackable → cmdb      → book
                              → service
```

Each entity file stores only its **own** properties. The `entityMap` contains the fully resolved set.

## Entity-Centric Schema

```mermaid
flowchart LR
    subgraph Entity["task_entity.md"]
        E["properties:<br/>  status: { required: true }<br/>  priority: {}<br/>  area: {}"]
    end

    subgraph Properties
        S["status_property.md<br/>type: enum<br/>allowed_values: [...]"]
        P["priority_property.md<br/>type: enum"]
        A["area_property.md<br/>type: link<br/>target_type_key: area"]
    end

    E -->|references| S
    E -->|references| P
    E -->|references| A
```

## Three-Level Validation

```mermaid
flowchart TB
    F["File: my-task.md<br/>type_key: task<br/>status: In Progress<br/>area: '[[Work]]'<br/>foo: bar"]

    L1["<b>Level 1: Entity</b><br/>task allows: status, priority, area, ...<br/><br/>foo not in list -> <b>warning</b><br/>status missing & required -> <b>error</b>"]

    L2["<b>Level 2: Property</b><br/>status: enum -> In Progress OK<br/>area: link -> [[Work]] OK"]

    L3["<b>Level 3: Constraints</b><br/>Link: area target_type_key=area -> check Work note<br/>Custom JS validator -> run expression"]

    R["ValidationResult<br/><b>errors</b> + <b>warnings</b>"]

    F --> L1 --> L2 --> L3 --> R
```

**Warning** = field not in schema (non-blocking). **Error** = invalid value, missing required, or failed constraint (blocking).

## Data Flow

```mermaid
sequenceDiagram
    participant IO as CLI / Plugin<br/>(file I/O)
    participant S as schema.ts<br/>(parse + build)
    participant V as validate.ts<br/>(check)

    IO->>S: loadSchema(entityFiles[], propertyFiles[])

    Note over S: parseEntities() -> EntitySchema[]
    Note over S: parseProperties() -> PropertySchema[] + Zod
    Note over S: Build entityMap + allowExtraMap

    S-->>IO: VaultSchema

    IO->>V: validateFiles(targetFiles[], schema, options)

    Note over V: For each file:
    Note over V: 1. Parse frontmatter (gray-matter)
    Note over V: 2. Lookup entity type in entityMap
    Note over V: 3. Check known/unknown fields
    Note over V: 4. Zod.safeParse() each value
    Note over V: 5. Link constraints (if vaultIndex)
    Note over V: 6. Custom JS validator
    Note over V: 7. Required fields check

    V-->>IO: ValidationSummary
```

## Plugin Architecture

```mermaid
flowchart TB
    subgraph Obsidian
        VA[Vault API<br/>TFile, cachedRead]
        WS[Workspace<br/>ItemView, commands]
    end

    subgraph Plugin
        M[main.ts<br/>Plugin class]
        B[bridge.ts<br/>TFile->RawFile adapter]
        RV[ResultsView.ts<br/>Results panel]
        ST[SettingsTab.ts<br/>3-tab settings]
    end

    subgraph Core
        SC[schema.ts]
        VL[validate.ts]
    end

    VA --> B
    B --> SC
    B --> VL
    M --> B
    M --> RV
    M --> ST
    WS --> M
```

## property_type -> Zod Mapping

| property_type | Zod | Notes |
|---------------|-----|-------|
| `string` | `z.string()` | |
| `number` | `z.number().min().max()` | min/max from frontmatter |
| `boolean` | `z.boolean()` | |
| `date` | `z.union([z.string(), z.date()])` | gray-matter may return JS Date |
| `time` | `z.string()` | |
| `datetime` | `z.union([z.string(), z.date()])` | |
| `enum` | `z.preprocess(coerce, z.enum([...]))` | numbers coerced to strings |
| `link` | `z.union([z.string(), z.array()])` | + optional link constraints |
| `wikilink` | `z.union([z.string(), z.array()])` | alias for link |
| `list` | `z.array(z.unknown())` | + optional link constraints |
| `emoji` | `z.string()` | |
