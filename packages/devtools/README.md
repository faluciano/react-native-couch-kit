# @couch-kit/devtools

Debug overlay component for Couch Kit web controllers. Displays connection status, game state, and action history in a collapsible panel.

## Installation

```bash
bun add @couch-kit/devtools
```

Requires `@couch-kit/client` as a peer dependency (provides the `useDebugPanel` hook that feeds data to the overlay).

## Usage

Wire `useDebugPanel` (from `@couch-kit/client`) to the `DebugOverlay` component:

```tsx
import { useGameClient, useDebugPanel } from "@couch-kit/client";
import { DebugOverlay } from "@couch-kit/devtools";
import { gameReducer, initialState } from "./shared/types";

function App() {
  const client = useGameClient({ reducer: gameReducer, initialState });
  const debugData = useDebugPanel(client);

  return (
    <div>
      <Game {...client} />
      {import.meta.env.DEV && <DebugOverlay data={debugData} />}
    </div>
  );
}
```

## Props

| Prop               | Type                                                          | Default         | Description                              |
| ------------------ | ------------------------------------------------------------- | --------------- | ---------------------------------------- |
| `data`             | `DebugPanelData` (from `@couch-kit/client`)                   | **required**    | Debug data from `useDebugPanel`          |
| `defaultCollapsed` | `boolean`                                                     | `false`         | Start collapsed                          |
| `position`         | `"top-left" \| "top-right" \| "bottom-left" \| "bottom-right"` | `"bottom-right"` | Screen corner to anchor the panel        |
| `maxHeight`        | `number`                                                      | `400`           | Maximum pixel height of the panel body   |

```
