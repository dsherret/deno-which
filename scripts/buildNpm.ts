import { build, emptyDir } from "@deno/dnt";

Deno.chdir(new URL("../", import.meta.url));

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  shims: {},
  test: false,
  compilerOptions: {
    stripInternal: false,
    skipLibCheck: false,
    lib: ["ESNext"],
    target: "ES2022",
  },
  scriptModule: false,
  declarationMap: false,
  skipSourceOutput: true,
  package: {
    name: "@dsherret/which",
    // only used for publishing, so a placeholder is fine for local builds
    version: Deno.args[0] ?? "0.0.0",
    description: "Finds the path to the specified command.",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/dsherret/deno-which.git",
    },
    keywords: [
      "which",
      "path",
      "command",
      "executable",
    ],
    bugs: {
      url: "https://github.com/dsherret/deno-which/issues",
    },
    devDependencies: {
      "@types/node": "^24.0.0",
    },
  },
  async postBuild() {
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    const readme = await Deno.readTextFile("README.md");
    await Deno.writeTextFile(
      "npm/README.md",
      readme.replaceAll('"@david/which"', '"@dsherret/which"'),
    );
  },
});
