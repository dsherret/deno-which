export interface Environment {
  /** Gets an environment variable. */
  env(key: string): string | undefined;
  /** Checks if the file exists asynchronously. */
  fileExists(filePath: string): Promise<boolean>;
  /** Checks if the file exists synchronously. */
  fileExistsSync(filePath: string): boolean;
  /** Gets the current operating system. */
  os: typeof Deno.build.os;
}

export class RealEnvironment implements Environment {
  env(key: string): string | undefined {
    return Deno.env.get(key);
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      const result = await Deno.stat(path);
      return result.isFile;
    } catch (err) {
      if (err instanceof Deno.errors.PermissionDenied) {
        throw err;
      }
      return false;
    }
  }

  fileExistsSync(path: string): boolean {
    try {
      const result = Deno.statSync(path);
      return result.isFile;
    } catch (err) {
      if (err instanceof Deno.errors.PermissionDenied) {
        throw err;
      }
      return false;
    }
  }

  get os() {
    return Deno.build.os;
  }
}

/** Finds the path to the specified command asynchronously. */
export async function which(
  command: string,
  environment: Omit<Environment, "fileExistsSync"> = new RealEnvironment(),
) {
  const systemInfo = getSystemInfo(command, environment);
  if (systemInfo == null) {
    return undefined;
  }

  for (const pathItem of systemInfo.pathItems) {
    const filePath = pathItem + command;
    if (systemInfo.pathExts) {
      for (const pathExt of systemInfo.pathExts) {
        const filePath = pathItem + command + pathExt;
        if (await environment.fileExists(filePath)) {
          return filePath;
        }
      }
    } else {
      if (await environment.fileExists(filePath)) {
        return filePath;
      }
    }
  }

  return undefined;
}

/** Finds the path to the specified command synchronously. */
export function whichSync(
  command: string,
  environment: Omit<Environment, "fileExists"> = new RealEnvironment(),
) {
  const systemInfo = getSystemInfo(command, environment);
  if (systemInfo == null) {
    return undefined;
  }

  for (const pathItem of systemInfo.pathItems) {
    const filePath = pathItem + command;
    if (environment.fileExistsSync(filePath)) {
      return filePath;
    }
    if (systemInfo.pathExts) {
      for (const pathExt of systemInfo.pathExts) {
        const filePath = pathItem + command + pathExt;
        if (environment.fileExistsSync(filePath)) {
          return filePath;
        }
      }
    }
  }

  return undefined;
}

interface SystemInfo {
  pathItems: string[];
  pathExts: string[] | undefined;
  isNameMatch: (a: string, b: string) => boolean;
}

function getSystemInfo(
  command: string,
  environment: Omit<Environment, "fileExists" | "fileExistsSync">,
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
