# deno_which

[![deno doc](https://doc.deno.land/badge.svg)](https://doc.deno.land/https/deno.land/x/which/mod.ts)

Finds the path to the specified command.

```ts
import { which, whichSync } from "https://deno.land/x/which/mod.ts";

const pathToCurl = await which("curl");
```
