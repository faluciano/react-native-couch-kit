import { Command } from "commander";
import fs from "fs-extra";
import path from "path";
import ora from "ora";
import { toErrorMessage } from "@couch-kit/core";

export const initCommand = new Command("init")
  .description("Scaffolds a new web controller project")
  .argument("[name]", "Project name", "web-controller")
  .action(async (name) => {
    const spinner = ora(`Creating ${name}...`).start();

    try {
      const targetDir = path.resolve(process.cwd(), name);

      if (fs.existsSync(targetDir)) {
        throw new Error(`Directory ${name} already exists`);
      }

      await fs.ensureDir(targetDir);

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
          "@couch-kit/client": "workspace:*",
        },
        devDependencies: {
          "@types/react": "^18.2.66",
          "@types/react-dom": "^18.2.22",
          "@vitejs/plugin-react": "^4.2.1",
          typescript: "^5.2.2",
          vite: "^5.2.0",
        },
      };

      await fs.writeJson(path.join(targetDir, "package.json"), packageJson, {
        spaces: 2,
      });

      // Create basic tsconfig
      await fs.writeJson(
        path.join(targetDir, "tsconfig.json"),
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
            noUnusedLocals: true,
            noUnusedParameters: true,
            noFallthroughCasesInSwitch: true,
          },
          include: ["src"],
          references: [{ path: "./tsconfig.node.json" }],
        },
        { spaces: 2 },
      );

      // Create tsconfig.node.json
      await fs.writeJson(
        path.join(targetDir, "tsconfig.node.json"),
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
        { spaces: 2 },
      );

      // Create vite.config.ts
      await fs.writeFile(
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
      await fs.ensureDir(path.join(targetDir, "src"));

      // Create index.html
      await fs.writeFile(
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
      await fs.writeFile(
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
      await fs.writeFile(
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

      await fs.writeFile(
        path.join(targetDir, "src/index.css"),
        `
body { margin: 0; background: #111; color: #fff; }
`,
      );

      spinner.succeed(`Created new project in ${name}`);
      console.log(
        `\nNext steps:\n  cd ${name}\n  bun install\n  bun run dev\n`,
      );
    } catch (e) {
      spinner.fail(`Init failed: ${toErrorMessage(e)}`);
      process.exit(1);
    }
  });
