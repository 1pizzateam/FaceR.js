import dts from "rollup-plugin-dts";

const config = [
  {
    input: "build/es6/facer.js",
    external: ["@1pizzateam/spock", "@1pizzateam/roostr"],
    output: {
      file: "build/facer.mjs",
      format: "es",
      generatedCode: "es2015",
    },
  },
  {
    input: "build/es6/facer.d.ts",
    external: ["@1pizzateam/spock", "@1pizzateam/roostr"],
    output: {
      file: "build/facer.d.mts",
      format: "es",
    },
    plugins: [dts()],
  },
];

export default config;
