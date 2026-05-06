# RecourseOS for Raycast

Quick consequence evaluation from your macOS command bar.

## Features

### Evaluate Command

Open Raycast, type "Evaluate Command", and paste any shell command to check for destructive consequences:

- **BLOCK**: High-risk commands that may cause data loss
- **ESCALATE**: Commands that need human confirmation
- **ALLOW**: Safe commands

### Quick Evaluate Clipboard

Instantly evaluate whatever's in your clipboard with a keyboard shortcut:

1. Copy a command
2. Trigger "Quick Evaluate Clipboard"
3. See HUD notification with risk level

## Installation

### Raycast Store

Search for "RecourseOS" in the Raycast Store.

### Manual Install

```bash
cd integrations/raycast-recourse
npm install
npm run dev
```

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Evaluate Command | - | Full evaluation with details |
| Quick Evaluate Clipboard | ⌘⇧R | Instant clipboard check |

## Risk Detection

### High Risk (BLOCK)

- `rm -rf`
- `--recursive` (with delete operations)
- `DROP DATABASE` / `DROP TABLE`
- `TRUNCATE`
- `--skip-final-snapshot`
- `delete-db-instance`

### Medium Risk (ESCALATE)

- `delete`
- `remove`
- `terminate`
- `destroy`
- `kubectl delete`
- `docker rm`
- `aws s3 rm`

## Screenshots

### Evaluate Command

```
┌────────────────────────────────────────┐
│ 🛑 BLOCK                               │
│                                        │
│ Command:                               │
│ aws s3 rm s3://prod-data --recursive   │
│                                        │
│ Risk Level: BLOCK                      │
│ Tier: unrecoverable                    │
│ Reasoning: High-risk destructive       │
│            patterns detected           │
│                                        │
│ ⚠️ Do not execute this command.        │
└────────────────────────────────────────┘
```

### Quick Evaluate

```
┌─────────────────────────────────────┐
│  🛑 BLOCK: High-risk destructive    │
│             command                 │
└─────────────────────────────────────┘
```

## Keyboard Shortcuts

Set up custom shortcuts in Raycast preferences:

1. Open Raycast Preferences
2. Go to Extensions → RecourseOS
3. Assign hotkeys to commands

Recommended:
- `⌘⇧R` - Quick Evaluate Clipboard
- `⌃⌥R` - Evaluate Command

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Publish to Raycast Store
npm run publish
```

## License

MIT
