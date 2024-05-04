# deno-which

[![deno doc](https://jsr.io/badges/@david/which)](https://jsr.io/@david/which)

Finds the path to the specified command.

```ts
import { which, whichSync } from "jsr:@david/which@0.3";

const pathToCurl = await which("curl");
```

## Custom Environment

If you want to use this with an fake or in memory environment, then you can
provide a custom environment as the second parameter.

For example:

```ts
const pathToCurl = await which("curl", {
  os: "windows",
  async fileExists(filePath: string) {
    // implement this
  },
  env(key: string) {
    // implement getting an environment variable
  },
  requestPermission(folderPath: string): void {
    Deno.permissions.requestSync({
      name: "read",
      path: folderPath,
    });
  },
});
```
