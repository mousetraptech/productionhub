import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

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
  ],
};
