import { resolve } from "node:path";
import { Command } from "commander";
import { replayActions, toErrorMessage } from "@couch-kit/core";
import type { Recording } from "@couch-kit/core";

export const replay = new Command("replay")
  .description("Replay a recorded game session against a reducer")
  .argument("<recording>", "Path to recording JSON file")
  .argument(
    "<reducer>",
    "Path to reducer module (must export default or named 'reducer')",
  )
  .option("--snapshots", "Output intermediate state snapshots", false)
  .option("--json", "Output as formatted JSON", false)
  .action(
    async (
      recordingPath: string,
      reducerPath: string,
      options: { snapshots: boolean; json: boolean },
    ) => {
      try {
        const resolvedRecordingPath = resolve(recordingPath);
        const recordingFile = Bun.file(resolvedRecordingPath);
        const exists = await recordingFile.exists();

        if (!exists) {
          console.error(`Error: Recording file not found: ${recordingPath}`);
          process.exit(1);
        }

        const recording: Recording = await recordingFile.json();

        if (!recording.initialState || !Array.isArray(recording.actions)) {
          console.error(
            "Error: Invalid recording format. Expected { initialState, actions[] }",
          );
          process.exit(1);
        }

        // Load reducer module
        const resolvedReducerPath = resolve(reducerPath);
        const reducerModule = await import(resolvedReducerPath);
        const reducer = reducerModule.default ?? reducerModule.reducer;

        if (typeof reducer !== "function") {
          console.error(
            "Error: Reducer module must export a default function or named 'reducer' export",
          );
          process.exit(1);
        }

        const result = replayActions(recording, reducer);

        if (options.json) {
          const output = options.snapshots
            ? result
            : {
                finalState: result.finalState,
                duration: result.duration,
                actionCount: result.actionCount,
              };
          console.log(JSON.stringify(output, null, 2));
        } else {
          console.log(
            `Replayed ${result.actionCount} actions in ${result.duration}ms`,
          );
          console.log("\nFinal state:");
          console.log(JSON.stringify(result.finalState, null, 2));

          if (options.snapshots) {
            console.log(`\nSnapshots (${result.snapshots.length}):`);
            for (const snapshot of result.snapshots) {
              console.log(
                `\n  [${snapshot.index}] ${JSON.stringify(snapshot.action)} @ ${snapshot.timestamp}`,
              );
              console.log(`  State: ${JSON.stringify(snapshot.state)}`);
            }
          }
        }
      } catch (error) {
        console.error(`Error: ${toErrorMessage(error)}`);
        process.exit(1);
      }
    },
  );
