# @party-kit/core

Shared TypeScript definitions and protocol logic for the React Native Party Kit.

## Purpose

This package ensures that both the Host (TV) and Client (Phone) speak the exact same language. By sharing types, we get end-to-end type safety.

## Key Exports

### `createGameReducer`

A helper to define type-safe reducers.

```typescript
import { createGameReducer } from '@party-kit/core';

export const gameReducer = createGameReducer<MyState, MyAction>((state, action) => {
  // ...
});
```

### `IGameState` & `IAction`

Base interfaces that your game types should extend.

```typescript
import { IGameState, IAction } from '@party-kit/core';

interface MyState extends IGameState {
    score: number;
}

interface MyAction extends IAction {
    type: 'SCORE';
}
```

### Protocol Definitions

Access the raw message types if you are building a custom client/host implementation.

*   `ClientMessage`: Messages sent from Phone -> TV (JOIN, ACTION, PING).
*   `HostMessage`: Messages sent from TV -> Phone (WELCOME, STATE_UPDATE, PONG).
