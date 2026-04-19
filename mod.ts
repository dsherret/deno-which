/** Operating system identifier returned by {@linkcode Environment.os}. */
export type OsType =
  | "darwin"
  | "linux"
  | "windows"
  | "freebsd"
  | "netbsd"
  | "aix"
  | "solaris"
  | "illumos";

export interface Environment {
  /** Gets an environment variable. */
  env(key: string): string | undefined;
  /** Resolves the file info for the specified path following symlinks. */
  stat(filePath: string): Promise<{ isFile: boolean }>;
  /** Synchronously resolves the file info for the specified path
   * following symlinks.
   */
  statSync(filePath: string): { isFile: boolean };
  /** Gets the current operating system. */
  os: OsType;
  /** Optional method for requesting broader permissions for a folder
   * instead of asking for each file when the operating system requires
   * probing multiple files for an executable path.
   *
   * This is not the default, but is useful on Windows for example.
   */
  requestPermission?(folderPath: string): void;
}

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
const isDeno = denoGlobal != null;
// deno-lint-ignore no-explicit-any
const nodeProcess: any = isDeno ? undefined : (globalThis as any).process;
// deno-lint-ignore no-explicit-any
const nodeFs: any = isDeno
  ? undefined
  : nodeProcess.getBuiltinModule("node:fs");

/** Default implementation that interacts with the file system and process env vars. */
export class RealEnvironment implements Environment {
  env(key: string): string | undefined {
    if (isDeno) {
      return denoGlobal.env.get(key);
    }
    return nodeProcess.env[key];
  }

  async stat(path: string): Promise<{ isFile: boolean }> {
    if (isDeno) {
      return await denoGlobal.stat(path);
    }
    const info = await nodeFs.promises.stat(path);
    return { isFile: info.isFile() };
  }

  statSync(path: string): { isFile: boolean } {
    if (isDeno) {
      return denoGlobal.statSync(path);
    }
    const info = nodeFs.statSync(path);
    return { isFile: info.isFile() };
  }

  get os(): OsType {
    if (isDeno) {
      return denoGlobal.build.os;
    }
    return nodeProcess.platform === "win32"
      ? "windows"
      : (nodeProcess.platform as OsType);
  }
}

/** Finds the path to the specified command asynchronously. */
export async function which(
  command: string,
  environment: Omit<Environment, "statSync"> = new RealEnvironment(),
): Promise<string | undefined> {
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

/** Finds the path to the specified command synchronously. */
export function whichSync(
  command: string,
  environment: Omit<Environment, "stat"> = new RealEnvironment(),
): string | undefined {
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
  return isDeno && err instanceof denoGlobal.errors.PermissionDenied;
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
  const isWindows = environment.os === "windows";
  const envValueSeparator = isWindows ? ";" : ":";
  const path = environment.env("PATH");
  const pathSeparator = isWindows ? "\\" : "/";
  if (path == null) {
    return undefined;
  }

  return {
    pathItems: splitEnvValue(path).map((item) => normalizeDir(item)),
    pathExts: getPathExts(),
    isNameMatch: isWindows
      ? (a, b) => a.toLowerCase() === b.toLowerCase()
      : (a, b) => a === b,
  };

  function getPathExts() {
    if (!isWindows) {
      return undefined;
    }

    const pathExtText = environment.env("PATHEXT") ?? ".EXE;.CMD;.BAT;.COM";
    const pathExts = splitEnvValue(pathExtText);
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

  function splitEnvValue(value: string) {
    return value
      .split(envValueSeparator)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  function normalizeDir(dirPath: string) {
    if (!dirPath.endsWith(pathSeparator)) {
      dirPath += pathSeparator;
    }
    return dirPath;
  }
}
