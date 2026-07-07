import { test } from "node:test";
import { equal, rejects, throws } from "node:assert/strict";
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
      lstat(p) {
        p = p.replace(/\//g, "\\");
        if (p === "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE") {
          return Promise.resolve({ isFile: true, isSymlink: false });
        } else {
          return Promise.reject(new Error("Not found."));
        }
      },
      lstatSync(p) {
        p = p.replace(/\//g, "\\");
        if (p === "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE") {
          return { isFile: true, isSymlink: false };
        } else {
          throw new Error("Not found.");
        }
      },
      readLink() {
        return Promise.reject(new Error("not a symlink"));
      },
      readLinkSync() {
        throw new Error("not a symlink");
      },
      isWindows: true,
    };
    let result = await which("asdfasdfasdfasdfasdf", environment);
    result = result?.replace(/\//g, "\\");
    equal(result, "C:\\test\\home\\asdfasdfasdfasdfasdf.EXE");
  });
});

test(
  "should resolve a path-like command with .exe on windows",
  { skip: !isWindows },
  async () => {
    await withTempDir(async (tempPath) => {
      const exePath = path.join(tempPath, "my-custom-binary.exe");
      fs.copyFileSync(expectedCurlLocation, exePath);
      const relativePath = "./" + path.relative(process.cwd(), tempPath) +
        "/my-custom-binary";
      equal(
        (await which(relativePath))?.toLowerCase(),
        (relativePath + ".exe").toLowerCase(),
      );
      equal(
        whichSync(relativePath)?.toLowerCase(),
        (relativePath + ".exe").toLowerCase(),
      );
      const absPath = path.join(tempPath, "my-custom-binary");
      equal(
        (await which(absPath))?.toLowerCase(),
        exePath.toLowerCase(),
      );
      equal(
        whichSync(absPath)?.toLowerCase(),
        exePath.toLowerCase(),
      );
    });
  },
);

test("should return path-like command as-is when file exists", async () => {
  await withTempDir(async (tempPath) => {
    const filePath = path.join(
      tempPath,
      "existing-file" + (isWindows ? ".exe" : ""),
    );
    fs.copyFileSync(expectedCurlLocation, filePath);
    equal(
      (await which(filePath))?.toLowerCase(),
      filePath.toLowerCase(),
    );
    equal(
      whichSync(filePath)?.toLowerCase(),
      filePath.toLowerCase(),
    );
  });
});

test("should return undefined for a path-like command that doesn't exist", async () => {
  const missing = path.join(os.tmpdir(), "definitely-missing-binary-xyz");
  equal(await which(missing), undefined);
  equal(whichSync(missing), undefined);
});

const eaccesErr = Object.assign(new Error("EACCES"), { code: "EACCES" });
const enoentErr = Object.assign(new Error("ENOENT"), { code: "ENOENT" });

test("should fall back via lstat when stat fails with EACCES (Windows app exec alias)", async () => {
  // Simulates a Windows Store app execution alias: stat fails (EACCES on
  // the reparse point), but lstat reports the entry as a regular file.
  await runTest(async (which) => {
    const target = "C:\\WindowsApps\\winget.EXE";
    const environment: Environment = {
      env(key) {
        if (key === "PATH") return "C:\\WindowsApps";
        if (key === "PATHEXT") return ".EXE";
        return undefined;
      },
      stat() {
        return Promise.reject(eaccesErr);
      },
      statSync() {
        throw eaccesErr;
      },
      lstat(p) {
        return p.replace(/\//g, "\\") === target
          ? Promise.resolve({ isFile: true, isSymlink: false })
          : Promise.reject(enoentErr);
      },
      lstatSync(p) {
        if (p.replace(/\//g, "\\") === target) {
          return { isFile: true, isSymlink: false };
        }
        throw enoentErr;
      },
      readLink() {
        return Promise.reject(new Error("not a symlink"));
      },
      readLinkSync() {
        throw new Error("not a symlink");
      },
      isWindows: true,
    };
    const result = (await which("winget", environment))?.replace(/\//g, "\\");
    equal(result, target);
  });
});

test("should walk the symlink chain when stat fails with EACCES", async () => {
  // A symlink in PATH whose target stat can't traverse. The library should
  // follow it via lstat+readLink until reaching a regular file.
  await runTest(async (which) => {
    const link = "C:\\bin\\my-winget.EXE";
    const finalTarget = "C:\\Apps\\winget.exe";
    const environment: Environment = {
      env(key) {
        if (key === "PATH") return "C:\\bin";
        if (key === "PATHEXT") return ".EXE";
        return undefined;
      },
      stat() {
        return Promise.reject(eaccesErr);
      },
      statSync() {
        throw eaccesErr;
      },
      lstat(p) {
        const n = p.replace(/\//g, "\\");
        if (n === link) {
          return Promise.resolve({ isFile: false, isSymlink: true });
        }
        if (n === finalTarget) {
          return Promise.resolve({ isFile: true, isSymlink: false });
        }
        return Promise.reject(enoentErr);
      },
      lstatSync(p) {
        const n = p.replace(/\//g, "\\");
        if (n === link) return { isFile: false, isSymlink: true };
        if (n === finalTarget) return { isFile: true, isSymlink: false };
        throw enoentErr;
      },
      readLink(p) {
        if (p.replace(/\//g, "\\") === link) {
          return Promise.resolve(finalTarget);
        }
        return Promise.reject(new Error("not a symlink"));
      },
      readLinkSync(p) {
        if (p.replace(/\//g, "\\") === link) return finalTarget;
        throw new Error("not a symlink");
      },
      isWindows: true,
    };
    const result = (await which("my-winget", environment))?.replace(
      /\//g,
      "\\",
    );
    equal(result, link);
  });
});

test("should rethrow Deno permission errors from stat", async () => {
  // Simulates a Deno runtime permission denial: a PermissionDenied-style
  // error without code "EACCES". Must NOT be silently swallowed.
  class PermissionDenied extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "PermissionDenied";
    }
  }
  const denoPermErr = new PermissionDenied("Requires read access");
  const environment: Environment = {
    env(key) {
      if (key === "PATH") return "/usr/bin";
      return undefined;
    },
    stat() {
      return Promise.reject(denoPermErr);
    },
    statSync() {
      throw denoPermErr;
    },
    lstat() {
      return Promise.reject(new Error("should not be called"));
    },
    lstatSync() {
      throw new Error("should not be called");
    },
    readLink() {
      return Promise.reject(new Error("should not be called"));
    },
    readLinkSync() {
      throw new Error("should not be called");
    },
    isWindows: false,
  };
  // Stub Deno.errors.PermissionDenied for the instanceof check.
  // deno-lint-ignore no-explicit-any
  const deno = (globalThis as any).Deno;
  if (deno != null) {
    const prevPD = deno.errors?.PermissionDenied;
    deno.errors = deno.errors ?? {};
    deno.errors.PermissionDenied = PermissionDenied;
    try {
      await rejects(which("anything", environment), PermissionDenied);
      throws(() => whichSync("anything", environment), PermissionDenied);
    } finally {
      deno.errors.PermissionDenied = prevPD;
    }
  }
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

test("should resolve a command from a PATH entry that uses forward slashes on windows", async () => {
  // stat here rejects mixed-slash paths, so it only matches fully backslashed.
  await runTest(async (which) => {
    const target = ".\\bin\\foo.CMD";
    const environment: Environment = {
      env(key) {
        if (key === "PATH") return "./bin";
        if (key === "PATHEXT") return ".CMD";
        return undefined;
      },
      stat(p) {
        return p === target
          ? Promise.resolve({ isFile: true })
          : Promise.reject(new Error("Not found."));
      },
      statSync(p) {
        if (p === target) {
          return { isFile: true };
        }
        throw new Error("Not found.");
      },
      lstat() {
        return Promise.reject(new Error("not called"));
      },
      lstatSync() {
        throw new Error("not called");
      },
      readLink() {
        return Promise.reject(new Error("not a symlink"));
      },
      readLinkSync() {
        throw new Error("not a symlink");
      },
      isWindows: true,
    };
    equal(await which("foo", environment), target);
  });
});

test("should resolve a command from a UNC PATH entry that uses forward slashes on windows", async () => {
  // The UNC root's leading "\\" must survive slash normalization.
  await runTest(async (which) => {
    const target = "\\\\server\\share\\foo.CMD";
    const environment: Environment = {
      env(key) {
        if (key === "PATH") return "//server/share";
        if (key === "PATHEXT") return ".CMD";
        return undefined;
      },
      stat(p) {
        return p === target
          ? Promise.resolve({ isFile: true })
          : Promise.reject(new Error("Not found."));
      },
      statSync(p) {
        if (p === target) {
          return { isFile: true };
        }
        throw new Error("Not found.");
      },
      lstat() {
        return Promise.reject(new Error("not called"));
      },
      lstatSync() {
        throw new Error("not called");
      },
      readLink() {
        return Promise.reject(new Error("not a symlink"));
      },
      readLinkSync() {
        throw new Error("not a symlink");
      },
      isWindows: true,
    };
    equal(await which("foo", environment), target);
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
