export interface Environment {
  /** Gets an environment variable. */
  env(key: string): string | undefined;
  /** Resolves the file info for the specified path following symlinks. */
  stat(filePath: string): Promise<{ isFile: boolean }>;
  /** Synchronously resolves the file info for the specified path
   * following symlinks.
   */
  statSync(filePath: string): { isFile: boolean };
  /** Resolves the file info for the specified path without following symlinks.
   *
   * On Windows, the library falls back to this when {@link Environment.stat}
   * throws with EACCES — needed to resolve Windows Store app execution aliases,
   * whose reparse points cause stat to fail with EACCES but lstat to succeed.
   * If the entry is itself a symlink, the library walks the chain via
   * {@link Environment.readLink} until it reaches a file (handles the case of
   * a user-created symlink pointing at a Store app alias).
   */
  lstat(filePath: string): Promise<{ isFile: boolean; isSymlink: boolean }>;
  /** Synchronous variant of {@link Environment.lstat}. */
  lstatSync(filePath: string): { isFile: boolean; isSymlink: boolean };
  /** Reads the literal target of a symlink. Used to walk symlink chains
   * when stat can't traverse them. */
  readLink(filePath: string): Promise<string>;
  /** Synchronous variant of {@link Environment.readLink}. */
  readLinkSync(filePath: string): string;
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

  async lstat(
    path: string,
  ): Promise<{ isFile: boolean; isSymlink: boolean }> {
    if (denoGlobal?.lstat) {
      return await denoGlobal.lstat(path);
    }
    const info = await getNodeFs().promises.lstat(path);
    return { isFile: info.isFile(), isSymlink: info.isSymbolicLink() };
  }

  lstatSync(path: string): { isFile: boolean; isSymlink: boolean } {
    if (denoGlobal?.lstatSync) {
      return denoGlobal.lstatSync(path);
    }
    const info = getNodeFs().lstatSync(path);
    return { isFile: info.isFile(), isSymlink: info.isSymbolicLink() };
  }

  async readLink(path: string): Promise<string> {
    if (denoGlobal?.readLink) {
      return await denoGlobal.readLink(path);
    }
    return await getNodeFs().promises.readlink(path);
  }

  readLinkSync(path: string): string {
    if (denoGlobal?.readLinkSync) {
      return denoGlobal.readLinkSync(path);
    }
    return getNodeFs().readlinkSync(path);
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
  environment: Omit<Environment, "statSync" | "lstatSync" | "readLinkSync"> =
    new RealEnvironment(),
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
  environment: Omit<Environment, "statSync" | "lstatSync" | "readLinkSync">,
  path: string,
): Promise<boolean> {
  try {
    return (await environment.stat(path)).isFile;
  } catch (statErr) {
    if (isDenoNotCapableError(statErr)) {
      throw statErr;
    }
    // on Windows, EACCES on stat is the signal for Store app execution
    // aliases and similar reparse points stat can't traverse — fall back
    // to lstat, and walk via readLink if the entry is itself a symlink
    if (environment.isWindows && isEaccesError(statErr)) {
      return await followSymlinkChain(environment, path);
    }
    return false;
  }
}

async function followSymlinkChain(
  environment: Pick<Environment, "lstat" | "readLink">,
  path: string,
): Promise<boolean> {
  let current = path;
  for (let hops = 0; hops < 40; hops++) {
    let info;
    try {
      info = await environment.lstat(current);
    } catch (err) {
      if (isDenoNotCapableError(err)) {
        throw err;
      }
      return false;
    }
    if (info.isFile) return true;
    if (!info.isSymlink) return false;
    let target;
    try {
      target = await environment.readLink(current);
    } catch (err) {
      if (isDenoNotCapableError(err)) {
        throw err;
      }
      return false;
    }
    current = resolveLinkTarget(current, target);
  }
  return false;
}

/** Finds the path to the specified command synchronously.
 *
 * See {@link which} for the path-separator handling rules.
 */
export function whichSync(
  command: string,
  environment: Omit<Environment, "stat" | "lstat" | "readLink"> =
    new RealEnvironment(),
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
  environment: Omit<Environment, "stat" | "lstat" | "readLink">,
  path: string,
): boolean {
  try {
    return environment.statSync(path).isFile;
  } catch (statErr) {
    if (isDenoNotCapableError(statErr)) {
      throw statErr;
    }
    // see comment in pathMatches
    if (environment.isWindows && isEaccesError(statErr)) {
      return followSymlinkChainSync(environment, path);
    }
    return false;
  }
}

function followSymlinkChainSync(
  environment: Pick<Environment, "lstatSync" | "readLinkSync">,
  path: string,
): boolean {
  let current = path;
  for (let hops = 0; hops < 40; hops++) {
    let info;
    try {
      info = environment.lstatSync(current);
    } catch (err) {
      if (isDenoNotCapableError(err)) {
        throw err;
      }
      return false;
    }
    if (info.isFile) return true;
    if (!info.isSymlink) return false;
    let target;
    try {
      target = environment.readLinkSync(current);
    } catch (err) {
      if (isDenoNotCapableError(err)) {
        throw err;
      }
      return false;
    }
    current = resolveLinkTarget(current, target);
  }
  return false;
}

function resolveLinkTarget(linkPath: string, target: string): string {
  if (isAbsolutePath(target)) {
    return target;
  }
  const sepIdx = Math.max(
    linkPath.lastIndexOf("/"),
    linkPath.lastIndexOf("\\"),
  );
  const dir = sepIdx >= 0 ? linkPath.slice(0, sepIdx + 1) : "";
  return dir + target;
}

function isAbsolutePath(p: string): boolean {
  if (p.startsWith("/") || p.startsWith("\\")) return true;
  // windows drive-rooted (e.g. "C:\foo" or "C:/foo")
  return /^[A-Za-z]:[\\/]/.test(p);
}

function isEaccesError(err: unknown): boolean {
  return err != null && typeof err === "object" && "code" in err &&
    (err as { code?: unknown }).code === "EACCES";
}

function isDenoNotCapableError(err: unknown): boolean {
  const notCapableError = denoGlobal?.errors?.NotCapable;
  return notCapableError != null && err instanceof notCapableError;
}

interface SystemInfo {
  pathItems: string[];
  pathExts: string[] | undefined;
  isNameMatch: (a: string, b: string) => boolean;
}

function getSystemInfo(
  command: string,
  environment: Pick<Environment, "isWindows" | "env">,
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
  if (pathSeparator === "\\" && dirPath.includes("/")) {
    dirPath = normalizeWindowsSeparators(dirPath, pathSeparator);
  }
  if (!dirPath.endsWith(pathSeparator)) {
    dirPath += pathSeparator;
  }
  return dirPath;
}

function normalizeWindowsSeparators(dirPath: string, pathSeparator: string) {
  // Preserve a UNC root's leading "\\"; collapse interior repeats only.
  const isUncRoot = /^[/\\]{2}/.test(dirPath);
  const head = isUncRoot ? pathSeparator + pathSeparator : "";
  const rest = isUncRoot ? dirPath.slice(2) : dirPath;
  return head +
    rest.replaceAll("/", pathSeparator).replace(/\\+/g, pathSeparator);
}
