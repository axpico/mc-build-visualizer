import { defineConfig, Plugin } from 'vite';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Dev only: serve the local Minecraft client jar so the editor loads it without a file picker.
// The jar never enters the build output (Mojang assets must not be hosted).
function localJar(): Plugin {
  const find = (): string | null => {
    if (process.env.MC_JAR) return existsSync(process.env.MC_JAR) ? process.env.MC_JAR : null;
    const dir = join(homedir(), '.local/share/PrismLauncher/libraries/com/mojang/minecraft');
    if (!existsSync(dir)) return null;
    const newest = readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
    const jar = newest && join(dir, newest, `minecraft-${newest}-client.jar`);
    return jar && existsSync(jar) ? jar : null;
  };
  return {
    name: 'local-jar',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__local-jar', (_req, res) => {
        const jar = find();
        if (!jar) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', 'application/java-archive');
        res.setHeader('X-Jar-Name', jar.split('/').at(-1)!);
        createReadStream(jar).pipe(res);
      });
    },
  };
}

// base './' so the static build works under a GitHub Pages sub-path
export default defineConfig({ base: './', plugins: [localJar()] });
