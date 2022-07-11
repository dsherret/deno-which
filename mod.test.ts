import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.147.0/testing/asserts.ts";
import { Environment, which, whichSync } from "./mod.ts";

const expectedCurlLocation = await getLocation("curl");

Deno.test("should get path", async () => {
  await runTest(async (which) => {
    const result = await which("curl");
    checkMatches(result, expectedCurlLocation);
  });
});

Deno.test("should return undefined for non-existent path", async () => {
  await runTest(async (which) => {
    const result = await which("asdfasdfasdfasdfasdf");
    checkMatches(result, undefined);
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

Deno.test("should get path when using exe on windows", {
  ignore: Deno.build.os !== "windows",
}, async () => {
  await runTest(async (which) => {
    const result = await which("curl.exe");
    checkMatches(result, expectedCurlLocation);
  });
});

async function runTest(
  action: (
    whichFunction: (cmd: string, environment?: Environment) => Promise<string | undefined>,
  ) => Promise<void>,
) {
  await action(which);
  await action((cmd, environment) => {
    try {
      return Promise.resolve(whichSync(cmd, environment));
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

Deno.test("should get existent path when providing a custom system", async () => {
  await runTest(async (which) => {
    const environment: Environment = {
      env(key) {
        if (key === "PATH") {
          return "C:\\test\\home;C:\\other"
        } else if (key === "PATHEXT") {
          return ".BAT;.EXE";
        } else {
          return undefined;
        }
      },
      fileExists(path) {
        path = path.replace(/\//g, "\\");
        if (path === "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE") {
          return Promise.resolve(true);
        } else {
          return Promise.resolve(false);
        }
      },
      fileExistsSync(path) {
        path = path.replace(/\//g, "\\");
        if (path === "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE") {
          return true;
        } else {
          return false;
        }
      },
      os: "windows",
    };
    let result = await which("asdfasdfasdfasdfasdf", environment);
    result = result?.replace(/\//g, "\\");
    assertEquals(result, "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE");
  });
});