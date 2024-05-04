import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.182.0/testing/asserts.ts";
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

Deno.test("should get exe on windows when file exists with no extension", {
  ignore: Deno.build.os !== "windows",
}, async () => {
  await withTempDir(async (path) => {
    const originalPath = Deno.env.get("PATH")!;
    try {
      const curlWithExePath = path + "\\curl.exe";
      Deno.copyFileSync(expectedCurlLocation, curlWithExePath);
      Deno.copyFileSync(expectedCurlLocation, path + "\\curl");
      Deno.env.set(
        "PATH",
        path + ";" + originalPath,
      );
      assertEquals(
        (await which("curl"))?.toLowerCase(),
        curlWithExePath.toLowerCase(),
      );
      assertEquals(
        whichSync("curl")?.toLowerCase(),
        curlWithExePath.toLowerCase(),
      );
    } finally {
      Deno.env.set("PATH", originalPath);
    }
  });
});

Deno.test("should get existent path when providing a custom system", async () => {
  await runTest(async (which) => {
    const environment: Environment = {
      env(key) {
        if (key === "PATH") {
          return "C:\\test\\home;C:\\other";
        } else if (key === "PATHEXT") {
          return ".BAT;.EXE";
        } else {
          return undefined;
        }
      },
      stat(path) {
        path = path.replace(/\//g, "\\");
        if (path === "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE") {
          return Promise.resolve({
            isFile: true,
          });
        } else {
          return Promise.reject(new Error("Not found."));
        }
      },
      statSync(path) {
        path = path.replace(/\//g, "\\");
        if (path === "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE") {
          return {
            isFile: true,
          };
        } else {
          throw new Error("Not found.");
        }
      },
      os: "windows",
    };
    let result = await which("asdfasdfasdfasdfasdf", environment);
    result = result?.replace(/\//g, "\\");
    assertEquals(result, "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE");
  });
});

Deno.test("should get the path to a symlink", async () => {
  await withTempDir((path) => {
    const isWindows = Deno.build.os === "windows";
    const newCurlPath = path + (isWindows ? "\\" : "/") +
      "temp-curl-deno-which" + (isWindows ? ".exe" : "");
    Deno.symlinkSync(expectedCurlLocation, newCurlPath);
    Deno.env.set(
      "PATH",
      path + (isWindows ? ";" : ":") + Deno.env.get("PATH")!,
    );
    assertEquals(
      whichSync("temp-curl-deno-which")?.toLowerCase(),
      newCurlPath.toLowerCase(),
    );
  });
});

async function runTest(
  action: (
    whichFunction: (
      cmd: string,
      environment?: Environment,
    ) => Promise<string | undefined>,
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
  const p = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
  }).output();
  return new TextDecoder().decode(p.stdout).split(/\r?\n/)[0];
}

async function withTempDir(action: (path: string) => Promise<void> | void) {
  const originalDirPath = Deno.cwd();
  const dirPath = Deno.makeTempDirSync();
  Deno.chdir(dirPath);
  try {
    await action(dirPath);
  } finally {
    try {
      await Deno.remove(dirPath, { recursive: true });
    } catch {
      // ignore
    }
    Deno.chdir(originalDirPath);
  }
}
