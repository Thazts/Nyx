/**
 * stage-sidecars.mjs
 * Compiles nyx-keyman and NyxCli binaries and stages them as Tauri sidecars.
 */

import { execSync } from "child_process";
import { mkdirSync, copyFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const tauriDir = resolve(root, "src-tauri");
const releaseDir = resolve(tauriDir, "target", "release");
const extraBinDir = resolve(tauriDir, "extra-bin");

const TARGET = "x86_64-pc-windows-msvc";

const BINARIES = [
  {
    sidecarName: `nyx-keyman-${TARGET}.exe`,
    src: "nyx-keyman.exe",
  },
  {
    sidecarName: `NyxCli-${TARGET}.exe`,
    src: "NyxCli.exe",
  },
];

// 1. Ensure extra-bin directory exists
mkdirSync(extraBinDir, { recursive: true });

// 2. Create placeholder sidecar files so tauri-build validation passes
for (const { sidecarName } of BINARIES) {
  const destPath = resolve(extraBinDir, sidecarName);

  if (!existsSync(destPath)) {
    writeFileSync(destPath, "");
    console.log(`  Created placeholder: ${sidecarName}`);
  }
}

// 3. Compile the sidecar binaries
console.log("⚙  Compiling sidecar binaries…");

execSync("cargo build --release --bin nyx-keyman --bin NyxCli", {
  cwd: tauriDir,
  stdio: "inherit",
});

// 4. Copy compiled binaries over the placeholders
for (const { sidecarName, src } of BINARIES) {
  const srcPath = resolve(releaseDir, src);
  const destPath = resolve(extraBinDir, sidecarName);

  if (!existsSync(srcPath)) {
    console.error(`✗ Missing compiled binary: ${srcPath}`);
    process.exit(1);
  }

  copyFileSync(srcPath, destPath);
  console.log(`✓ Staged ${sidecarName}`);
}

console.log("✓ All sidecar binaries staged.");