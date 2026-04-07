import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import tar from 'tar-fs';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export class ShardBuilder {
    static async build(shardPath: string, slug: string): Promise<void> {
        console.log(`[SHARD_BUILDER] Starting build for ${slug} at ${shardPath}...`);
        
        let dockerfileContent = '';
        const tag = `shard-${slug}:latest`;

        // Determine template based on files
        const userProvidedDocker = fs.existsSync(path.join(shardPath, 'Dockerfile'));

        if (userProvidedDocker) {
            console.log(`[SHARD_BUILDER] Detected native Dockerfile for ${slug}. Respecting custom configuration.`);
        } else {
            if (fs.existsSync(path.join(shardPath, 'package.json'))) {
                console.log(`[SHARD_BUILDER] Detected Node.js project for ${slug}`);
                dockerfileContent = `
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && \\
    npm install --omit=dev --no-audit --no-fund --prefer-offline --legacy-peer-deps && \\
    apk del python3 make g++
COPY . .
# Start generic entrypoint if it exists
CMD ["npm", "start"]
                `.trim();
            } else if (fs.existsSync(path.join(shardPath, 'index.html'))) {
                console.log(`[SHARD_BUILDER] Detected Static project for ${slug}`);
                dockerfileContent = `
FROM nginx:alpine
COPY . /usr/share/nginx/html/
EXPOSE 80
                `.trim();
            } else {
                // Default generic fallback
                console.log(`[SHARD_BUILDER] Detected Unknown generic project for ${slug}. Using slim alpine.`);
                dockerfileContent = `
FROM alpine:latest
WORKDIR /app
COPY . .
CMD ["tail", "-f", "/dev/null"]
                `.trim();
            }

            // Write the generated Dockerfile to the shard path
            fs.writeFileSync(path.join(shardPath, 'Dockerfile'), dockerfileContent);
        }
        
        console.log(`[SHARD_BUILDER] Dockerfile created, archiving and streaming to Docker daemon for ${slug}...`);

        const logFile = path.join(shardPath, 'logs.txt');
        fs.writeFileSync(logFile, `[SYSTEM] Initiating Docker build for ${slug}...\n`);

        return new Promise(async (resolve, reject) => {
            const { spawn } = await import('child_process');

            const buildProcess = spawn('docker', ['build', '-t', tag, '.'], {
                cwd: shardPath,
                env: { ...process.env, DOCKER_BUILDKIT: '1' }
            });

            buildProcess.stdout.on('data', (data) => {
                const text = data.toString('utf8');
                if (text.trim()) {
                    console.log(`[BUILD ${slug}]`, text.trim());
                    fs.appendFileSync(logFile, text);
                }
            });

            buildProcess.stderr.on('data', (data) => {
                const text = data.toString('utf8');
                if (text.trim()) {
                    console.error(`[BUILD ${slug}]`, text.trim());
                    fs.appendFileSync(logFile, text);
                }
            });

            buildProcess.on('close', (code) => {
                if (code !== 0) {
                    const err = new Error(`Docker build failed with code ${code}`);
                    fs.appendFileSync(logFile, `\n[ERROR] Build failed with code ${code}\n`);
                    return reject(err);
                }
                console.log(`[SHARD_BUILDER] Build successfully completed for ${slug} -> ${tag}`);
                fs.appendFileSync(logFile, `\n[SUCCESS] Build successfully completed.\n`);
                resolve();
            });

            buildProcess.on('error', (err) => {
                fs.appendFileSync(logFile, `\n[ERROR] Process communication failed: ${err.message}\n`);
                reject(err);
            });
        });
    }
}
