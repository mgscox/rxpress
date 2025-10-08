import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import path, { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRootDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const nodeModulesIndex = moduleDir.indexOf(`${path.sep}node_modules${path.sep}`);
  let rootDir = moduleDir;

  if (nodeModulesIndex >= 0) {
    // intalled as a npm module; – slice at the segment boundary.
    rootDir = moduleDir.slice(0, nodeModulesIndex);
  }
  else {
    // in development environment - walk up tree to find 'node_modulles' that is not for this npm package
    let parent = resolve(moduleDir);

    while (true) {
      let current = resolve(parent, '..');

      if (existsSync(join(current, 'node_modules'))) {
        const existsPkg = existsSync(join(current, 'node_modules'));
        let pkg;

        try {
          pkg = existsPkg
            ? JSON.parse(readFileSync(join(current, 'package.json'), { encoding: 'utf-8' }))
            : null;
        }
        catch {
          /* ignore json error */
        }
        finally {
          if (!pkg || pkg.name !== 'rxpress') {
            rootDir = current;
            break;
          }
        }
      }

      // bail if we got to root of server
      if (current === parent) {
        rootDir = current;
        break;
      }

      parent = current;
    }
  }

  return rootDir;
}

let rootDir = findRootDir();
const pkgCache: { value?: Record<string, unknown> } = {};
const defaultEnvFiles = ['.env'];

export namespace ConfigService {
  export const getDirname = (importMetaUrl: string) => {
    const __filename = fileURLToPath(importMetaUrl);
    const __dirname = dirname(__filename);
    return __dirname;
  };

  export function setRootDir(dir: string): void {
    rootDir = resolve(dir);
  }

  export function getRootDir(): string {
    return rootDir;
  }

  export function resolveFromRootDir(...segments: string[]): string {
    return resolve(rootDir, ...segments);
  }

  export function env<T>(field: string, defaultValue?: T): T {
    return (process.env[field] ?? defaultValue) as T;
  }

  export function pkg(): Record<string, unknown> {
    if (!pkgCache.value) {
      const pkgFilename = join(rootDir, 'package.json');
      pkgCache.value = existsSync(pkgFilename)
        ? JSON.parse(readFileSync(pkgFilename, { encoding: 'utf-8' }))
        : {};
    }

    return pkgCache.value!;
  }

  export function loadEnv(envFiles: string[] = defaultEnvFiles): void {
    const files = envFiles.map((file) => resolve(rootDir, file));

    for (const file of files) {
      if (existsSync(file)) {
        config({ path: file, encoding: 'utf8', override: false });
      }
    }
  }
}
