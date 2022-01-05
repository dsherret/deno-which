export async function which(command: string) {
  const systemInfo = getSystemInfo();
  if (systemInfo == null) {
    return undefined;
  }

  for (const pathItem of systemInfo.pathItems) {
    for (const entry of await safeReadDir(pathItem)) {
      if (isMatch(systemInfo, command, entry)) {
        return getMatchPath(pathItem, entry);
      }
    }
  }

  return undefined;
}

export function whichSync(command: string) {
  const systemInfo = getSystemInfo();
  if (systemInfo == null) {
    return undefined;
  }

  for (const pathItem of systemInfo.pathItems) {
    for (const entry of safeReadDirSync(pathItem)) {
      if (isMatch(systemInfo, command, entry)) {
        return getMatchPath(pathItem, entry);
      }
    }
  }

  return undefined;
}

async function safeReadDir(path: string) {
  try {
    const items = [];
    for await (const entry of await Deno.readDir(path)) {
      items.push(entry);
    }
    return items;
  } catch (err) {
    if (err instanceof Deno.errors.PermissionDenied) {
      throw err;
    }
    return [];
  }
}

function safeReadDirSync(path: string) {
  try {
    return Deno.readDirSync(path);
  } catch (err) {
    if (err instanceof Deno.errors.PermissionDenied) {
      throw err;
    }
    // ignore any errors
    return [];
  }
}

function getMatchPath(pathItem: string, entry: Deno.DirEntry) {
  const separator = Deno.build.os === "windows" ? "\\" : "/";
  return pathItem + separator + entry.name;
}

function isMatch(
  systemInfo: SystemInfo,
  command: string,
  entry: Deno.DirEntry,
) {
  if (!entry.isFile) {
    return false;
  }

  if (systemInfo.isNameMatch(entry.name, command)) {
    return true;
  }
  if (systemInfo.pathExts) {
    for (const pathExt of systemInfo.pathExts) {
      if (systemInfo.isNameMatch(entry.name, command + pathExt)) {
        return true;
      }
    }
  }
  return false;
}

interface SystemInfo {
  pathItems: string[];
  pathExts: string[] | undefined;
  isNameMatch: (a: string, b: string) => boolean;
}

function getSystemInfo(): SystemInfo | undefined {
  const isWindows = Deno.build.os === "windows";
  const pathSeparator = isWindows ? ";" : ":";
  const path = Deno.env.get("PATH");
  if (path == null) {
    return undefined;
  }

  const pathExt = isWindows
    ? (Deno.env.get("PATHEXT") ?? ".EXE;.CMD;.BAT;.COM")
    : undefined;
  return {
    pathItems: splitEnvValue(path),
    pathExts: pathExt != null ? splitEnvValue(pathExt) : undefined,
    isNameMatch: isWindows
      ? (a, b) => a.toLowerCase() === b.toLowerCase()
      : (a, b) => a === b,
  };

  function splitEnvValue(value: string) {
    return value
      .split(pathSeparator)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}
