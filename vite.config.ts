import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

export default defineConfig(async () => {
    const DevtoolsResolved = fs.existsSync(path.resolve(__dirname, "src/devtools"))
        ? path.resolve(__dirname, "src/devtools/index")
        : path.resolve(__dirname, "src/devtools-stub/index");

    return {
        plugins: [react()],
        clearScreen: false,
        server: {
            port: 1420,
            strictPort: true,
            watch: {
                ignored: ["**/src-tauri/**"],
            },
        },
        resolve: {
            alias: {
                "@media":    path.resolve(__dirname, "media"),
                "@devtools": DevtoolsResolved,
            },
        },
        publicDir: "media",
    };
});
