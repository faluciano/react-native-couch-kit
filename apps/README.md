# Example Apps: The Buzzer Game 🚨

This directory contains a complete reference implementation of a local multiplayer "Buzzer" game using `react-native-party-kit`.

## 📂 Structure

*   **`buzzer-logic`**: Shared game state, actions, and reducer. This is a pure TypeScript package imported by both Host and Client to ensure rule synchronization.
*   **`example-host`**: The TV application. Built with **React Native (Expo)**. It runs the WebSocket server and the game UI.
*   **`example-controller`**: The mobile controller website. Built with **Vite + React**. Players access this via their phone browser to buzz in.

## 🏃‍♂️ How to Run

### Prerequisites
*   **Node.js** (LTS)
*   **Bun** (recommended) or npm/yarn
*   **Android Studio** (for Android TV emulator) OR **Xcode** (for Apple TV simulator)

### 1. Start the TV Host (The Console)

The Host app must be built natively because it uses native networking modules.

```bash
cd apps/example-host
bun install

# For Android TV (Ensure Android TV emulator is running)
npx expo run:android

# For Apple TV (Ensure Xcode is installed)
npx expo run:ios
```

**Note:** The first run will trigger `npx expo prebuild` automatically to configure the native TV projects.

### 2. Start the Web Controller (The Gamepad)

Run the controller in development mode on your computer.

```bash
cd apps/example-controller
bun install
bun run dev --host
```

*   The `--host` flag exposes the server to your local network so phones can connect.

### 3. Connect & Play (Dev Mode)

1.  The **TV Host** will display a QR code and a server URL (e.g., `ws://192.168.1.50:8081`).
2.  In `apps/example-host/App.tsx`, `devMode` is enabled by default. This allows the TV to accept connections from the Vite dev server.
3.  Open the URL shown in your terminal from Step 2 on your phone (or scan the QR code if configured to point to your dev machine).
4.  **Buzz in!** 🔴

## 🐛 Troubleshooting

*   **"Network Error" on Phone:** Ensure your phone and computer are on the exact same Wi-Fi network.
*   **Emulator Connection:** Android Emulators use `10.0.2.2` to talk to the host machine. You might need to manually set the URL in the controller code if testing strictly on an emulator loopback.
