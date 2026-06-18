import Docker from 'dockerode';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { SHARDS_DIR } from '../config/paths.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export class ShardRunner {
    /**
     * Boot a standard single-container shard (built from Dockerfile).
     */
    static async boot(slug: string, envVarsParam: any, defaultPort: number = 3000): Promise<{ ip: string; port: number }> {
        console.log(`[SHARD_RUNNER] Booting container for ${slug}...`);
        
        const containerName = `stardust-shard-${slug}`;
        const imageName = `shard-${slug}:latest`;

        // 1. Delete existing container if any
        try {
            const existingContainer = docker.getContainer(containerName);
            const data = await existingContainer.inspect();
            if (data.State.Running) {
                console.log(`[SHARD_RUNNER] Stopping existing container ${containerName}...`);
                await existingContainer.stop();
            }
            console.log(`[SHARD_RUNNER] Removing existing container ${containerName}...`);
            await existingContainer.remove({ force: true });
        } catch (err: any) {
            if (err.statusCode !== 404) {
               console.warn(`[SHARD_RUNNER] Warning while removing container:`, err.message);
            }
        }

        // 2. Prepare Environment Variables and detect PORT
        let finalPort = defaultPort;
        let envArray: string[] = [];
        
        if (envVarsParam) {
            try {
                if (typeof envVarsParam === 'string' && envVarsParam.trim().startsWith('{')) {
                    const parsedEnv = JSON.parse(envVarsParam);
                    for (const [key, value] of Object.entries(parsedEnv)) {
                        envArray.push(`${key}=${value}`);
                        if (key.toUpperCase() === 'PORT') {
                            finalPort = parseInt(value as string, 10) || 3000;
                        }
                    }
                } else if (typeof envVarsParam === 'string') {
                    const lines = envVarsParam.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#')) continue;
                        const match = trimmed.match(/^([^=]+)=(.*)$/);
                        if (match) {
                            const key = match[1].trim();
                            const value = match[2].trim().replace(/^['"](.*)['""]$/, '$1');
                            envArray.push(`${key}=${value}`);
                            if (key.toUpperCase() === 'PORT') {
                                finalPort = parseInt(value, 10) || 3000;
                            }
                        }
                    }
                } else if (typeof envVarsParam === 'object') {
                    for (const [key, value] of Object.entries(envVarsParam)) {
                        envArray.push(`${key}=${value}`);
                        if (key.toUpperCase() === 'PORT') {
                            finalPort = parseInt(value as string, 10) || 3000;
                        }
                    }
                }
            } catch (err) {
                console.warn(`[SHARD_RUNNER] Error parsing env vars for ${slug}. Proceeding with defaults.`);
            }
        }
        
        if (!envArray.some(e => e.toUpperCase().startsWith('PORT='))) {
            envArray.push(`PORT=${finalPort}`);
        }
        
        if (!envArray.some(e => e.toUpperCase().startsWith('N8N_USER_FOLDER='))) {
            envArray.push(`N8N_USER_FOLDER=/app/data`);
        }

        // 3. Setup Persistent Volume
        const persistentPath = path.join(process.cwd(), 'persistent_data', slug);
        if (!fs.existsSync(persistentPath)) {
            fs.mkdirSync(persistentPath, { recursive: true });
        }
        try {
             fs.chmodSync(persistentPath, 0o777);
        } catch (e) {
             console.warn(`[SHARD_RUNNER] Could not chmod 777 persistent directory for ${slug}`, e);
        }

        // 4. Create Container
        console.log(`[SHARD_RUNNER] Creating container ${containerName}...`);
        const container = await docker.createContainer({
            Image: imageName,
            name: containerName,
            Env: envArray,
            Labels: {
                'com.stardust.shard': slug
            },
            ExposedPorts: {
                [`${finalPort}/tcp`]: {}
            },
            HostConfig: {
                Binds: [
                     `${persistentPath}:/app/data`
                ],
                Memory: 512 * 1024 * 1024, // 512 MB Hard Limit
                NetworkMode: 'stardust_internal',
                RestartPolicy: { Name: 'unless-stopped' }
            }
        });

        // 5. Start Container
        console.log(`[SHARD_RUNNER] Starting container ${containerName}...`);
        await container.start();

        // 6. Inspect to get Internal IP
        const data = await container.inspect();
        const network = data.NetworkSettings.Networks['stardust_internal'];
        
        if (!network || !network.IPAddress) {
            throw new Error(`Could not determine internal IP for container ${containerName}`);
        }

        const internalIp = network.IPAddress;
        console.log(`[SHARD_RUNNER] Container ${containerName} is UP at IP: ${internalIp}. Waiting for health check on port ${finalPort}...`);
        
        const result = await ShardRunner._waitForPort(slug, internalIp, finalPort);
        
        if (!result.healthy) {
            console.error(`[SHARD_RUNNER] Health check failed for ${containerName} after 60s. Fetching logs...`);
            try {
                const logs = await container.logs({ stdout: true, stderr: true, tail: 50 });
                console.error(`[SHARD_RUNNER] Crash Logs for ${containerName}:\n${logs.toString('utf8')}`);
            } catch (logErr) {
                console.error(`[SHARD_RUNNER] Could not fetch logs for crash on ${containerName}`);
            }
            try { await container.stop(); } catch (e) {}
            throw new Error(`Health check timeout for ${containerName}`);
        }

        console.log(`[SHARD_RUNNER] Container ${containerName} is READY on port ${result.port}.`);
        return { ip: internalIp, port: result.port };
    }

    /**
     * Boot a compose-based shard by running docker compose up -d,
     * connecting services to the network, and resolving its IP.
     */
    static async bootCompose(slug: string, mainService: string | null, envVarsParam: any): Promise<{ ip: string; port: number }> {
        console.log(`[SHARD_RUNNER] Booting compose shard ${slug}, main service: ${mainService || 'auto-detect'}...`);
        
        const projectName = `stardust-${slug}`;
        const shardPath = path.join(SHARDS_DIR, slug);

        let envString = '';
        if (envVarsParam) {
            try {
                if (typeof envVarsParam === 'string' && envVarsParam.trim().startsWith('{')) {
                    const parsedEnv = JSON.parse(envVarsParam);
                    envString = Object.entries(parsedEnv).map(([k, v]) => `${k}=${v}`).join('\n');
                } else if (typeof envVarsParam === 'string') {
                    envString = envVarsParam;
                } else if (typeof envVarsParam === 'object') {
                    envString = Object.entries(envVarsParam).map(([k, v]) => `${k}=${v}`).join('\n');
                }
            } catch (err) {
                console.warn(`[SHARD_RUNNER] Error parsing env vars for compose ${slug}.`);
            }
        }
        
        if (envString) {
            fs.writeFileSync(path.join(shardPath, '.env'), envString);
        }

        // 1. Execute docker compose up -d
        await new Promise<void>((resolve, reject) => {
            const composeFile = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].find(f => fs.existsSync(path.join(shardPath, f)));
            
            if (!composeFile) {
                console.warn(`[SHARD_RUNNER] No compose file found in ${shardPath}, skipping docker compose up.`);
                return resolve();
            }

            const composeProcess = spawn('docker', [
                'compose',
                '-p', projectName,
                '-f', composeFile,
                'up', '-d', '--remove-orphans'
            ], {
                cwd: shardPath,
                env: { ...process.env }
            });

            composeProcess.on('close', (code) => {
                if (code !== 0) {
                    console.warn(`[SHARD_RUNNER] docker compose up failed with code ${code}`);
                    return reject(new Error(`docker compose up failed with code ${code}`));
                }
                resolve();
            });
            
            composeProcess.on('error', (err) => {
                reject(err);
            });
        });

        // 2. Connect containers to stardust_internal network
        let containers = await docker.listContainers({
            all: false,
            filters: { label: [`com.docker.compose.project=${projectName}`] }
        });

        try {
            const network = docker.getNetwork('stardust_internal');
            for (const c of containers) {
                try {
                    await network.connect({ Container: c.Id });
                    console.log(`[SHARD_RUNNER] Connected ${c.Names[0]} to stardust_internal`);
                } catch (connectErr: any) {
                    if (!connectErr.message?.includes('already exists')) {
                        console.warn(`[SHARD_RUNNER] Could not connect ${c.Names[0]}:`, connectErr.message);
                    }
                }
            }
        } catch (networkErr: any) {
            console.warn(`[SHARD_RUNNER] Network connection step failed for ${slug}:`, networkErr.message);
        }

        // Re-list running containers just in case
        containers = await docker.listContainers({
            all: false,
            filters: { label: [`com.docker.compose.project=${projectName}`] }
        });

        if (containers.length === 0) {
            throw new Error(`No running containers found for compose project ${projectName}`);
        }

        // Find the main service container
        let targetContainer = containers[0]; // default: first container
        if (mainService) {
            const found = containers.find(c =>
                c.Labels['com.docker.compose.service'] === mainService
            );
            if (found) {
                targetContainer = found;
            } else {
                console.warn(`[SHARD_RUNNER] Main service '${mainService}' not found in ${projectName}. Using first container.`);
            }
        }

        // Get IP from stardust_internal network
        const networks = targetContainer.NetworkSettings?.Networks || {};
        const stardustNet = networks['stardust_internal'];

        if (!stardustNet?.IPAddress) {
            throw new Error(`Container ${targetContainer.Names[0]} is not connected to stardust_internal network`);
        }

        const internalIp = stardustNet.IPAddress;
        
        // Try to detect the exposed port (from container ports or defaults)
        const exposedPorts = targetContainer.Ports || [];
        let guessPort = 80;
        if (exposedPorts.length > 0) {
            // Prefer the first private port
            const firstPort = exposedPorts.find(p => p.PrivatePort);
            if (firstPort) guessPort = firstPort.PrivatePort;
        }

        console.log(`[SHARD_RUNNER] Compose main container at IP: ${internalIp}. Health check on port ${guessPort}...`);
        
        const scanPorts = Array.from(new Set([guessPort, 3000, 80, 4000, 5000, 5173, 8080, 5678, 8000]));
        const result = await ShardRunner._waitForPort(slug, internalIp, guessPort, scanPorts);

        if (!result.healthy) {
            throw new Error(`Health check timeout for compose shard ${slug}`);
        }

        console.log(`[SHARD_RUNNER] Compose shard ${slug} is READY. IP: ${internalIp}:${result.port}`);
        return { ip: internalIp, port: result.port };
    }

    /**
     * Shared TCP health check with port auto-discovery.
     */
    private static _waitForPort(
        slug: string,
        ip: string,
        defaultPort: number,
        scanPorts?: number[],
        timeoutMs: number = 60000
    ): Promise<{ healthy: boolean; port: number }> {
        const ports = scanPorts ?? Array.from(new Set([defaultPort, 3000, 4000, 5000, 5173, 8080, 5678, 8000]));
        let detectedPort = defaultPort;

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({ healthy: false, port: detectedPort });
            }, timeoutMs);

            let sockets: net.Socket[] = [];

            const interval = setInterval(() => {
                for (const p of ports) {
                    const socket = new net.Socket();
                    sockets.push(socket);

                    socket.once('connect', () => {
                        clearTimeout(timeout);
                        clearInterval(interval);
                        for (const s of sockets) s.destroy();
                        detectedPort = p;
                        resolve({ healthy: true, port: p });
                    });

                    socket.once('error', () => {
                        socket.destroy();
                    });

                    socket.connect(p, ip);
                }
            }, 1000);
        });
    }
}
