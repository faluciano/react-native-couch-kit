# @party-kit/core

Shared TypeScript definitions and protocol logic for the React Native Party Kit.

## Purpose

This package ensures that both the Host (TV) and Client (Phone) speak the exact same language. By sharing types, we get end-to-end type safety across your entire full-stack game.

## Installation

```bash
bun add @party-kit/core
```

## Key Exports

### `createGameReducer`

A helper to define type-safe reducers that can be shared between the Host and Client.

```typescript
import { createGameReducer } from "@party-kit/core";
import { GameState, GameAction } from "./types";

export const gameReducer = createGameReducer<GameState, GameAction>(
  (state, action) => {
    switch (action.type) {
      case "SCORE":
        return { ...state, score: state.score + 1 };
      default:
        return state;
    }
  },
);
```

### `IGameState` & `IAction`

Base interfaces that your game types should extend to ensure compatibility with the Party Kit engine.

```typescript
import { IGameState, IAction } from "@party-kit/core";

export interface MyState extends IGameState {
  score: number;
  round: number;
}

export interface MyAction extends IAction {
  type: "SCORE" | "NEXT_ROUND";
}
```

### Protocol Definitions

Access the raw message types if you are building a custom client/host implementation or debugging the protocol.

- `ClientMessage`: Messages sent from Phone -> TV (JOIN, ACTION, PING).
- `HostMessage`: Messages sent from TV -> Phone (WELCOME, STATE_UPDATE, PONG).
