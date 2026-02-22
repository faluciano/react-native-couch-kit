---
"@couch-kit/host": minor
---

Replace legacy `copyAsync` with expo-file-system v19 `File` API for Android asset extraction

The `useExtractAssets` hook now uses `File.bytesSync()` and `File.write()` instead of the
deprecated `FileSystem.copyAsync()`, which throws in expo-file-system@19.

This is a **breaking change** for apps still on expo-file-system < 19 (Expo SDK < 54).
The `expo-file-system` peer dependency has been tightened from `>=17.0.0` to `>=19.0.0`.
