import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.119.0/testing/asserts.ts";
import { which, whichSync } from "./mod.ts";

Deno.test("should get path", async () => {
  const expectedLocation = await getLocation("curl");
  await runTest(async (which) => {
    const result = await which("curl");
    checkMatches(result, expectedLocation);
  });
});

Deno.test("should error when doesn't have permission", {
  permissions: {
    read: false,
  },
}, async () => {
  await runTest(async (which) => {
    await assertRejects(() => which("curl"), Deno.errors.PermissionDenied);
  });
});

async function runTest(
  action: (
    whichFunction: (cmd: string) => Promise<string | undefined>,
  ) => Promise<void>,
) {
  await action(which);
  await action((cmd) => {
    try {
      return Promise.resolve(whichSync(cmd));
    } catch (err) {
      return Promise.reject(err);
    }
  });
}

function checkMatches(a: string | undefined, b: string | undefined) {
  if (Deno.build.os === "windows") {
    if (a != null) {
      a = a.toLowerCase();
    }
    if (b != null) {
      b = b.toLowerCase();
    }
  }
  assertEquals(a, b);
}

async function getLocation(command: string) {
  const cmd = Deno.build.os === "windows"
    ? ["cmd", "/c", "where", command]
    : ["which", command];
  const p = await Deno.run({
    cmd,
    stdout: "piped",
  });
  try {
    return new TextDecoder().decode(await p.output()).split(/\r?\n/)[0];
  } finally {
    p.close();
  }
}
