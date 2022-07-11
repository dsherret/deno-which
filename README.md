# deno_which

[![deno doc](https://doc.deno.land/badge.svg)](https://doc.deno.land/https/deno.land/x/which/mod.ts)

Finds the path to the specified command.

```ts
import {
  which,
  whichSync,
} from "https://deno.land/x/which@VERSION_GOES_HERE/mod.ts";

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
});
```
