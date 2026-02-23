import { copyFileSync, mkdirSync } from "fs";
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

function copyManifest() {
  return {
    name: "copy-manifest",
    writeBundle() {
      mkdirSync("com.productionhub.deck.sdPlugin/bin", { recursive: true });
      copyFileSync(
        "com.productionhub.deck.sdPlugin/manifest.json",
        "com.productionhub.deck.sdPlugin/bin/manifest.json",
      );
    },
  };
}

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.productionhub.deck.sdPlugin/bin/plugin.js",
    format: "esm",
    sourcemap: true,
  },
  plugins: [
    nodeResolve(),
    commonjs(),
    typescript(),
    copyManifest(),
  ],
};
