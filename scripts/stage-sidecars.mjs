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
  {
    sidecarName: `Charon-${TARGET}.exe`,
    src: "Charon.exe",
  },
];

mkdirSync(extraBinDir, { recursive: true });

for (const { sidecarName } of BINARIES) {
  const destPath = resolve(extraBinDir, sidecarName);

  if (!existsSync(destPath)) {
    writeFileSync(destPath, "");
    console.log(`  Created placeholder: ${sidecarName}`);
  }
}

console.log("⚙  Compiling sidecar binaries…");

execSync("cargo build --release --bin nyx-keyman --bin NyxCli --bin Charon", {
  cwd: tauriDir,
  stdio: "inherit",
});

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