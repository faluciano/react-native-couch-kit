import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Register a DOM implementation so React components can be rendered and
// interacted with under Bun's test runner (which has no DOM by default).
GlobalRegistrator.register();
