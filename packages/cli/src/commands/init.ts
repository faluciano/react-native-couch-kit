import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { toErrorMessage } from "@couch-kit/core";

function detectPackageManager(): string {
  // Check for bun runtime
  if (typeof Bun !== "undefined") return "bun";

  // Check npm_config_user_agent
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.includes("yarn")) return "yarn";
  if (userAgent.includes("pnpm")) return "pnpm";
  if (userAgent.includes("bun")) return "bun";

  return "npm";
}

export const initCommand = new Command("init")
  .description("Scaffolds a new web controller project")
  .argument("[name]", "Project name", "web-controller")
  .action(async (name) => {
    console.log(`Creating ${name}...`);

    try {
      const targetDir = path.resolve(process.cwd(), name);

      if (fs.existsSync(targetDir)) {
        throw new Error(`Directory ${name} already exists`);
      }

      fs.mkdirSync(targetDir, { recursive: true });

      // Create minimal Vite + React + TS scaffold
      const packageJson = {
        name,
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: {
          dev: "vite",
          build: "tsc && vite build",
          preview: "vite preview",
        },
        dependencies: {
          react: "^18.2.0",
          "react-dom": "^18.2.0",
          "@couch-kit/client": "^0.4.3",
        },
        devDependencies: {
          "@types/react": "^18.2.66",
          "@types/react-dom": "^18.2.22",
          "@vitejs/plugin-react": "^4.2.1",
          typescript: "^5.2.2",
          vite: "^5.2.0",
        },
      };

      fs.writeFileSync(
        path.join(targetDir, "package.json"),
        JSON.stringify(packageJson, null, 2) + "\n",
      );

      // Create basic tsconfig
      fs.writeFileSync(
        path.join(targetDir, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2020",
              useDefineForClassFields: true,
              lib: ["ES2020", "DOM", "DOM.Iterable"],
              module: "ESNext",
              skipLibCheck: true,
              moduleResolution: "bundler",
              allowImportingTsExtensions: true,
              resolveJsonModule: true,
              isolatedModules: true,
              noEmit: true,
              jsx: "react-jsx",
              strict: true,
              noUncheckedIndexedAccess: true,
              exactOptionalPropertyTypes: true,
              noUnusedLocals: true,
              noUnusedParameters: true,
              noFallthroughCasesInSwitch: true,
            },
            include: ["src"],
            references: [{ path: "./tsconfig.node.json" }],
          },
          null,
          2,
        ) + "\n",
      );

      // Create tsconfig.node.json
      fs.writeFileSync(
        path.join(targetDir, "tsconfig.node.json"),
        JSON.stringify(
          {
            compilerOptions: {
              composite: true,
              skipLibCheck: true,
              module: "ESNext",
              moduleResolution: "bundler",
              allowSyntheticDefaultImports: true,
            },
            include: ["vite.config.ts"],
          },
          null,
          2,
        ) + "\n",
      );

      // Create vite.config.ts
      fs.writeFileSync(
        path.join(targetDir, "vite.config.ts"),
        `
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Important for relative paths in Android WebView
})
`,
      );

      // Create src directory
      fs.mkdirSync(path.join(targetDir, "src"), { recursive: true });

      // Create index.html
      fs.writeFileSync(
        path.join(targetDir, "index.html"),
        `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Game Controller</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      );

      // Create main.tsx
      fs.writeFileSync(
        path.join(targetDir, "src/main.tsx"),
        `
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`,
      );

      // Create App.tsx
      fs.writeFileSync(
        path.join(targetDir, "src/App.tsx"),
        `
import { useGameClient } from '@couch-kit/client';

function App() {
  const { status, playerId, sendAction } = useGameClient({
    initialState: { count: 0 },
    reducer: (state, action) => state // Dummy reducer
  });

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui' }}>
        <h1>Controller</h1>
        <p>Status: {status}</p>
        <p>ID: {playerId || 'Connecting...'}</p>
        <button onClick={() => sendAction({ type: 'BUZZ' })} 
                style={{ fontSize: 24, padding: '20px 40px', width: '100%' }}>
            BUZZ!
        </button>
    </div>
  )
}

export default App
`,
      );

      fs.writeFileSync(
        path.join(targetDir, "src/index.css"),
        `
body { margin: 0; background: #111; color: #fff; }
`,
      );

      // Write sample reducer
      const reducerContent = `import type { IAction, IGameState, GameReducer } from "@couch-kit/core";

export interface GameState extends IGameState {
  score: number;
  round: number;
}

export interface GameAction extends IAction {
  type: "SCORE" | "NEXT_ROUND" | "RESET";
  payload?: { points?: number };
}

export const gameReducer: GameReducer<GameState, GameAction> = (state, action) => {
  switch (action.type) {
    case "SCORE":
      return { ...state, score: state.score + (action.payload?.points ?? 1) };
    case "NEXT_ROUND":
      return { ...state, round: state.round + 1 };
    case "RESET":
      return { ...state, score: 0, round: 1 };
    default:
      return state;
  }
};

export const initialState: GameState = {
  status: "lobby",
  players: {},
  score: 0,
  round: 1,
};
`;
      fs.writeFileSync(path.join(targetDir, "src/reducer.ts"), reducerContent);

      // Write .gitignore
      const gitignoreContent = `node_modules/
dist/
lib/
.DS_Store
*.local
`;
      fs.writeFileSync(path.join(targetDir, ".gitignore"), gitignoreContent);

      const pm = detectPackageManager();

      console.log(`Done! Created new project in ${name}`);
      console.log(
        `\nNext steps:\n  cd ${name}\n  ${pm} install\n  ${pm} run dev\n`,
      );
    } catch (e) {
      console.error(`Init failed: ${toErrorMessage(e)}`);
      process.exit(1);
    }
  });
