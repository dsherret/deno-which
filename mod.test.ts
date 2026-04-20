import { test } from "node:test";
import { equal } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";
import { type Environment, which, whichSync } from "./mod.ts";

const isWindows = process.platform === "win32";
const expectedCurlLocation = getLocation("curl");

test("should get path", async () => {
  await runTest(async (which) => {
    const result = await which("curl");
    checkMatches(result, expectedCurlLocation);
  });
});

test("should return undefined for non-existent path", async () => {
  await runTest(async (which) => {
    const result = await which("asdfasdfasdfasdfasdf");
    checkMatches(result, undefined);
  });
});

test(
  "should get path when using exe on windows",
  { skip: !isWindows },
  async () => {
    await runTest(async (which) => {
      const result = await which("curl.exe");
      checkMatches(result, expectedCurlLocation);
    });
  },
);

test("should get exe on windows when file exists with no extension", {
  skip: !isWindows,
}, async () => {
  await withTempDir(async (tempPath) => {
    const originalPath = process.env.PATH!;
    try {
      const curlWithExePath = tempPath + "\\curl.exe";
      fs.copyFileSync(expectedCurlLocation, curlWithExePath);
      fs.copyFileSync(expectedCurlLocation, tempPath + "\\curl");
      process.env.PATH = tempPath + ";" + originalPath;
      equal(
        (await which("curl"))?.toLowerCase(),
        curlWithExePath.toLowerCase(),
      );
      equal(
        whichSync("curl")?.toLowerCase(),
        curlWithExePath.toLowerCase(),
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test("should get existent path when providing a custom system", async () => {
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
      stat(p) {
        p = p.replace(/\//g, "\\");
        if (p === "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE") {
          return Promise.resolve({ isFile: true });
        } else {
          return Promise.reject(new Error("Not found."));
        }
      },
      statSync(p) {
        p = p.replace(/\//g, "\\");
        if (p === "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE") {
          return { isFile: true };
        } else {
          throw new Error("Not found.");
        }
      },
      isWindows: true,
    };
    let result = await which("asdfasdfasdfasdfasdf", environment);
    result = result?.replace(/\//g, "\\");
    equal(result, "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE");
  });
});

test("should get the path to a symlink", async () => {
  await withTempDir((tempPath) => {
    const newCurlPath = path.join(
      tempPath,
      "temp-curl-deno-which" + (isWindows ? ".exe" : ""),
    );
    fs.symlinkSync(expectedCurlLocation, newCurlPath);
    const originalPath = process.env.PATH;
    process.env.PATH = tempPath + (isWindows ? ";" : ":") +
      (originalPath ?? "");
    try {
      equal(
        whichSync("temp-curl-deno-which")?.toLowerCase(),
        newCurlPath.toLowerCase(),
      );
    } finally {
      if (originalPath != null) {
        process.env.PATH = originalPath;
      } else {
        delete process.env.PATH;
      }
    }
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
  if (isWindows) {
    if (a != null) {
      a = a.toLowerCase();
    }
    if (b != null) {
      b = b.toLowerCase();
    }
  }
  equal(a, b);
}

function getLocation(command: string): string {
  const cmd = isWindows ? "where" : "which";
  const output = execFileSync(cmd, [command], { encoding: "utf-8" });
  return output.split(/\r?\n/)[0];
}

async function withTempDir(action: (dirPath: string) => Promise<void> | void) {
  const originalDir = process.cwd();
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), "which-test-"));
  process.chdir(dirPath);
  try {
    await action(dirPath);
  } finally {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
    process.chdir(originalDir);
  }
}
