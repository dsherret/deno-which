# deno-which

[![deno doc](https://jsr.io/badges/@david/which)](https://jsr.io/@david/which)

Finds the path to the specified command. Works in Deno and Node.js.

```sh
# Deno
> deno add @david/which

# Node.js
> npx jsr add @david/which
```

```ts
import { which, whichSync } from "@david/which";

const pathToCurl = await which("curl");
```

## Custom Environment

If you want to use this with an fake or in memory environment, then you can
provide a custom environment as the second parameter.

For example:

```ts
const pathToCurl = await which("curl", {
  isWindows: true,
  async stat(filePath: string): Promise<{ isFile: boolean }> {
    // implement this
  },
  statSync(filePath: string): { isFile: boolean } {
    // implement this
  },
  env(key: string): string | undefined {
    // implement getting an environment variable
  },
  // optional method for requesting broader permissions for a folder
  requestPermission(folderPath: string): void {
    Deno.permissions.requestSync({
      name: "read",
      path: folderPath,
    });
  },
});
```
