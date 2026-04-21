export interface Environment {
  /** Gets an environment variable. */
  env(key: string): string | undefined;
  /** Resolves the file info for the specified path following symlinks. */
  stat(filePath: string): Promise<{ isFile: boolean }>;
  /** Synchronously resolves the file info for the specified path
   * following symlinks.
   */
  statSync(filePath: string): { isFile: boolean };
  /** Whether the current operating system is Windows. */
  isWindows: boolean;
  /** Optional method for requesting broader permissions for a folder
   * instead of asking for each file when the operating system requires
   * probing multiple files for an executable path.
   *
   * This is not the default, but is useful on Windows for example.
   */
  requestPermission?(folderPath: string): void;
}

// dnt-shim-ignore
// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
const nodeProcess = globalThis.process;
// deno-lint-ignore no-explicit-any
let nodeFs: any | undefined;
// deno-lint-ignore no-explicit-any
function getNodeFs(): any {
  return nodeFs ??= nodeProcess.getBuiltinModule("node:fs");
}

/** Default implementation that interacts with the file system and process env vars. */
export class RealEnvironment implements Environment {
  env(key: string): string | undefined {
    if (denoGlobal?.env) {
      return denoGlobal.env.get(key);
    }
    return nodeProcess.env[key];
  }

  async stat(path: string): Promise<{ isFile: boolean }> {
    if (denoGlobal?.stat) {
      return await denoGlobal.stat(path);
    }
    const info = await getNodeFs().promises.stat(path);
    return { isFile: info.isFile() };
  }

  statSync(path: string): { isFile: boolean } {
    if (denoGlobal?.statSync) {
      return denoGlobal.statSync(path);
    }
    const info = getNodeFs().statSync(path);
    return { isFile: info.isFile() };
  }

  get isWindows(): boolean {
    if (denoGlobal?.build?.os) {
      return denoGlobal.build.os === "windows";
    }
    return nodeProcess.platform === "win32";
  }
}

/** Finds the path to the specified command asynchronously.
 *
 * When the command contains a path separator (e.g. `./foo` or `/usr/bin/foo`),
 * PATH is not searched. The file is resolved relative to the caller's context
 * and, on Windows, PATHEXT extensions are tried if the literal path doesn't
 * exist (so `./foo` resolves to `./foo.exe`).
 */
export async function which(
  command: string,
  environment: Omit<Environment, "statSync"> = new RealEnvironment(),
): Promise<string | undefined> {
  if (commandHasPathSeparator(command, environment.isWindows)) {
    if (await pathMatches(environment, command)) {
      return command;
    }
    const pathExts = getPathExts(command, environment);
    if (pathExts == null) {
      return undefined;
    }
    for (const pathExt of pathExts) {
      const filePath = command + pathExt;
      if (await pathMatches(environment, filePath)) {
        return filePath;
      }
    }
    return undefined;
  }

  const systemInfo = getSystemInfo(command, environment);
  if (systemInfo == null) {
    return undefined;
  }

  for (const pathItem of systemInfo.pathItems) {
    const filePath = pathItem + command;
    if (systemInfo.pathExts) {
      environment.requestPermission?.(pathItem);

      for (const pathExt of systemInfo.pathExts) {
        const filePath = pathItem + command + pathExt;
        if (await pathMatches(environment, filePath)) {
          return filePath;
        }
      }
    } else if (await pathMatches(environment, filePath)) {
      return filePath;
    }
  }

  return undefined;
}

async function pathMatches(
  environment: Omit<Environment, "statSync">,
  path: string,
): Promise<boolean> {
  try {
    const result = await environment.stat(path);
    return result.isFile;
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      throw err;
    }
    return false;
  }
}

/** Finds the path to the specified command synchronously.
 *
 * See {@link which} for the path-separator handling rules.
 */
export function whichSync(
  command: string,
  environment: Omit<Environment, "stat"> = new RealEnvironment(),
): string | undefined {
  if (commandHasPathSeparator(command, environment.isWindows)) {
    if (pathMatchesSync(environment, command)) {
      return command;
    }
    const pathExts = getPathExts(command, environment);
    if (pathExts == null) {
      return undefined;
    }
    for (const pathExt of pathExts) {
      const filePath = command + pathExt;
      if (pathMatchesSync(environment, filePath)) {
        return filePath;
      }
    }
    return undefined;
  }

  const systemInfo = getSystemInfo(command, environment);
  if (systemInfo == null) {
    return undefined;
  }

  for (const pathItem of systemInfo.pathItems) {
    const filePath = pathItem + command;
    if (systemInfo.pathExts) {
      environment.requestPermission?.(pathItem);

      for (const pathExt of systemInfo.pathExts) {
        const filePath = pathItem + command + pathExt;
        if (pathMatchesSync(environment, filePath)) {
          return filePath;
        }
      }
    } else if (pathMatchesSync(environment, filePath)) {
      return filePath;
    }
  }

  return undefined;
}

function pathMatchesSync(
  environment: Omit<Environment, "stat">,
  path: string,
): boolean {
  try {
    const result = environment.statSync(path);
    return result.isFile;
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      throw err;
    }
    return false;
  }
}

function isPermissionDeniedError(err: unknown): boolean {
  const permissionDeniedError = denoGlobal?.errors?.PermissionDenied;
  return permissionDeniedError != null && err instanceof permissionDeniedError;
}

interface SystemInfo {
  pathItems: string[];
  pathExts: string[] | undefined;
  isNameMatch: (a: string, b: string) => boolean;
}

function getSystemInfo(
  command: string,
  environment: Omit<Environment, "stat" | "statSync">,
): SystemInfo | undefined {
  const isWindows = environment.isWindows;
  const path = environment.env("PATH");
  const pathSeparator = isWindows ? "\\" : "/";
  if (path == null) {
    return undefined;
  }

  return {
    pathItems: splitEnvValue(path, isWindows).map((item) =>
      normalizeDir(item, pathSeparator)
    ),
    pathExts: getPathExts(command, environment),
    isNameMatch: isWindows
      ? (a, b) => a.toLowerCase() === b.toLowerCase()
      : (a, b) => a === b,
  };
}

function getPathExts(
  command: string,
  environment: Pick<Environment, "isWindows" | "env">,
): string[] | undefined {
  if (!environment.isWindows) {
    return undefined;
  }

  const pathExtText = environment.env("PATHEXT") ?? ".EXE;.CMD;.BAT;.COM";
  const pathExts = splitEnvValue(pathExtText, true);
  const lowerCaseCommand = command.toLowerCase();

  for (const pathExt of pathExts) {
    // Do not use the pathExts if someone has provided a command
    // that ends with the extenion of an executable extension
    if (lowerCaseCommand.endsWith(pathExt.toLowerCase())) {
      return undefined;
    }
  }

  return pathExts;
}

function commandHasPathSeparator(command: string, isWindows: boolean): boolean {
  return command.includes("/") || (isWindows && command.includes("\\"));
}

function splitEnvValue(value: string, isWindows: boolean) {
  const envValueSeparator = isWindows ? ";" : ":";
  return value
    .split(envValueSeparator)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeDir(dirPath: string, pathSeparator: string) {
  if (!dirPath.endsWith(pathSeparator)) {
    dirPath += pathSeparator;
  }
  return dirPath;
}
