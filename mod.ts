/** Finds the path to the specified command asynchronously. */
export async function which(command: string) {
  const systemInfo = getSystemInfo(command);
  if (systemInfo == null) {
    return undefined;
  }

  for (const pathItem of systemInfo.pathItems) {
    const filePath = pathItem + command;
    if (systemInfo.pathExts) {
      for (const pathExt of systemInfo.pathExts) {
        const filePath = pathItem + command + pathExt;
        if (await fileExists(filePath)) {
          return filePath;
        }
      }
    } else {
      if (await fileExists(filePath)) {
        return filePath;
      }
    }
  }

  return undefined;
}

/** Finds the path to the specified command synchronously. */
export function whichSync(command: string) {
  const systemInfo = getSystemInfo(command);
  if (systemInfo == null) {
    return undefined;
  }

  for (const pathItem of systemInfo.pathItems) {
    const filePath = pathItem + command;
    if (fileExistsSync(filePath)) {
      return filePath;
    }
    if (systemInfo.pathExts) {
      for (const pathExt of systemInfo.pathExts) {
        const filePath = pathItem + command + pathExt;
        if (fileExistsSync(filePath)) {
          return filePath;
        }
      }
    }
  }

  return undefined;
}

async function fileExists(path: string) {
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

function fileExistsSync(path: string) {
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

interface SystemInfo {
  pathItems: string[];
  pathExts: string[] | undefined;
  isNameMatch: (a: string, b: string) => boolean;
}

function getSystemInfo(command: string): SystemInfo | undefined {
  const isWindows = Deno.build.os === "windows";
  const envValueSeparator = isWindows ? ";" : ":";
  const path = Deno.env.get("PATH");
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

    const pathExtText = Deno.env.get("PATHEXT") ?? ".EXE;.CMD;.BAT;.COM";
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
