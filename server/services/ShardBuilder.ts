import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import tar from 'tar-fs';
import { spawn } from 'child_process';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * Detects if a shard directory contains a docker-compose file.
 * Returns the filename if found, null otherwise.
 */
export function detectComposeFile(shardPath: string): string | null {
    for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
        if (fs.existsSync(path.join(shardPath, name))) return name;
    }
    return null;
}

/**
 * Parses a docker-compose file to extract the list of service names.
 * Uses a lightweight regex approach to avoid requiring a YAML parser dependency.
 */
export function parseComposeServices(shardPath: string, composeFile: string): string[] {
    try {
        const content = fs.readFileSync(path.join(shardPath, composeFile), 'utf8');
        const services: string[] = [];
        let inServicesBlock = false;
        let servicesIndent = -1;

        for (const line of content.split('\n')) {
            const trimmed = line.trimEnd();
            if (!trimmed || trimmed.trimStart().startsWith('#')) continue;

            const leadingSpaces = trimmed.length - trimmed.trimStart().length;

            if (trimmed.trim() === 'services:') {
                inServicesBlock = true;
                servicesIndent = leadingSpaces;
                continue;
            }

            if (inServicesBlock) {
                // A service name is a key at exactly (servicesIndent + 2) indentation that ends with ':'
                if (leadingSpaces === servicesIndent + 2 && trimmed.trimStart().endsWith(':')) {
                    const serviceName = trimmed.trim().replace(/:$/, '');
                    if (serviceName && !serviceName.startsWith('-')) {
                        services.push(serviceName);
                    }
                } else if (leadingSpaces <= servicesIndent && trimmed.trimStart() !== '') {
                    // We've left the services block
                    inServicesBlock = false;
                }
            }
        }
        return services;
    } catch (err) {
        console.warn('[SHARD_BUILDER] Failed to parse compose services:', err);
        return [];
    }
}

export class ShardBuilder {
    static async build(shardPath: string, slug: string): Promise<void> {
        console.log(`[SHARD_BUILDER] Starting build for ${slug} at ${shardPath}...`);

        const logFile = path.join(shardPath, 'logs.txt');
        fs.writeFileSync(logFile, `[SYSTEM] Initiating build for ${slug}...\n`);

        // --- Docker Compose detection ---
        const composeFile = detectComposeFile(shardPath);
        if (composeFile) {
            console.log(`[SHARD_BUILDER] Detected ${composeFile} for ${slug}. Using Docker Compose flow.`);
            fs.appendFileSync(logFile, `[SYSTEM] Docker Compose detected (${composeFile}). Running compose build...\n`);
            return ShardBuilder._buildCompose(shardPath, slug, composeFile, logFile);
        }

        // --- Standard Dockerfile / auto-generated flow ---
        let dockerfileContent = '';
        const tag = `shard-${slug}:latest`;
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
RUN echo $'server { \\n\\
    listen 80; \\n\\
    root /usr/share/nginx/html; \\n\\
    index index.html; \\n\\
    location / { \\n\\
        try_files $uri $uri/ /index.html; \\n\\
    } \\n\\
}' > /etc/nginx/conf.d/default.conf
EXPOSE 80
                `.trim();
            } else {
                console.log(`[SHARD_BUILDER] Detected Unknown generic project for ${slug}. Using slim alpine.`);
                dockerfileContent = `
FROM alpine:latest
WORKDIR /app
COPY . .
CMD ["tail", "-f", "/dev/null"]
                `.trim();
            }

            fs.writeFileSync(path.join(shardPath, 'Dockerfile'), dockerfileContent);
        }

        console.log(`[SHARD_BUILDER] Dockerfile ready. Streaming to Docker daemon for ${slug}...`);
        fs.appendFileSync(logFile, `[SYSTEM] Building Docker image ${tag}...\n`);

        return new Promise((resolve, reject) => {
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

    /**
     * Build and start a shard using docker compose.
     * Connects all services to the stardust_internal network after startup.
     */
    static async _buildCompose(shardPath: string, slug: string, composeFile: string, logFile: string): Promise<void> {
        const projectName = `stardust-${slug}`;

        return new Promise((resolve, reject) => {
            // Use `docker compose up --build -d` to build & start all services
            const composeProcess = spawn('docker', [
                'compose',
                '-p', projectName,
                '-f', composeFile,
                'up', '--build', '-d', '--remove-orphans'
            ], {
                cwd: shardPath,
                env: { ...process.env }
            });

            composeProcess.stdout.on('data', (data) => {
                const text = data.toString('utf8');
                if (text.trim()) {
                    console.log(`[COMPOSE ${slug}]`, text.trim());
                    fs.appendFileSync(logFile, text);
                }
            });

            composeProcess.stderr.on('data', (data) => {
                const text = data.toString('utf8');
                if (text.trim()) {
                    // Docker compose writes progress to stderr — not always errors
                    console.log(`[COMPOSE ${slug}]`, text.trim());
                    fs.appendFileSync(logFile, text);
                }
            });

            composeProcess.on('close', async (code) => {
                if (code !== 0) {
                    const err = new Error(`docker compose up failed with code ${code}`);
                    fs.appendFileSync(logFile, `\n[ERROR] Compose up failed with code ${code}\n`);
                    return reject(err);
                }

                console.log(`[SHARD_BUILDER] Compose up complete for ${slug}. Connecting to stardust_internal network...`);
                fs.appendFileSync(logFile, `\n[SYSTEM] Compose up complete. Connecting containers to stardust_internal...\n`);

                // Connect every container of the project to the stardust_internal network
                try {
                    const containers = await docker.listContainers({
                        all: false,
                        filters: { label: [`com.docker.compose.project=${projectName}`] }
                    });

                    const network = docker.getNetwork('stardust_internal');
                    for (const c of containers) {
                        try {
                            await network.connect({ Container: c.Id });
                            console.log(`[SHARD_BUILDER] Connected ${c.Names[0]} to stardust_internal`);
                            fs.appendFileSync(logFile, `[SYSTEM] Connected ${c.Names[0]} to stardust_internal\n`);
                        } catch (connectErr: any) {
                            // Already connected is not an error
                            if (!connectErr.message?.includes('already exists')) {
                                console.warn(`[SHARD_BUILDER] Could not connect ${c.Names[0]}:`, connectErr.message);
                            }
                        }
                    }
                } catch (networkErr: any) {
                    console.warn(`[SHARD_BUILDER] Network connection step failed for ${slug}:`, networkErr.message);
                    fs.appendFileSync(logFile, `[WARN] Network connection step failed: ${networkErr.message}\n`);
                }

                fs.appendFileSync(logFile, `\n[SUCCESS] Compose build & start complete for ${slug}.\n`);
                resolve();
            });

            composeProcess.on('error', (err) => {
                fs.appendFileSync(logFile, `\n[ERROR] Compose process failed: ${err.message}\n`);
                reject(err);
            });
        });
    }
}
