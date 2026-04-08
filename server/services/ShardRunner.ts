import Docker from 'dockerode';
import net from 'net';
import fs from 'fs';
import path from 'path';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export class ShardRunner {
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
                // Legacy: If it looks like JSON, parse it
                if (typeof envVarsParam === 'string' && envVarsParam.trim().startsWith('{')) {
                    const parsedEnv = JSON.parse(envVarsParam);
                    for (const [key, value] of Object.entries(parsedEnv)) {
                        envArray.push(`${key}=${value}`);
                        if (key.toUpperCase() === 'PORT') {
                            finalPort = parseInt(value as string, 10) || 3000;
                        }
                    }
                } else if (typeof envVarsParam === 'string') {
                    // Modern: string parsing for KEY=VALUE (.env format)
                    const lines = envVarsParam.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#')) continue;
                        
                        const match = trimmed.match(/^([^=]+)=(.*)$/);
                        if (match) {
                            const key = match[1].trim();
                            const value = match[2].trim().replace(/^['"]|['"]$/g, ''); // strip quotes
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
        
        // 3. Generic Persistence Environment Variables
        const mandatoryEnv = {
            'PERSISTENT_DIR': '/app/data'
        };

        for (const [key, value] of Object.entries(mandatoryEnv)) {
            if (!envArray.some(e => e.toUpperCase().startsWith(`${key}=`))) {
                envArray.push(`${key}=${value}`);
            }
        }

        // 4. Setup Persistent Volume (Host side)
        // Use a relative path for flexibility across OS, but allow override via ENV
        const hostDataRoot = process.env.SHARD_DATA_PATH || path.join(process.cwd(), 'data');
        const persistentPath = path.resolve(hostDataRoot, slug);

        if (!fs.existsSync(persistentPath)) {
            console.log(`[SHARD_RUNNER] Creating persistence directory: ${persistentPath}`);
            fs.mkdirSync(persistentPath, { recursive: true, mode: 0o777 });
        }
        
        // Ensure wide permissions for Docker access
        try {
             fs.chmodSync(persistentPath, 0o777);
        } catch (e) {
             console.warn(`[SHARD_RUNNER] Warning: Could not chmod 777 persistent directory ${persistentPath}:`, e);
        }

        // 3. Create Container
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

        // 4. Start Container
        console.log(`[SHARD_RUNNER] Starting container ${containerName}...`);
        await container.start();

        // 5. Inspect to get Internal IP
        const data = await container.inspect();
        const network = data.NetworkSettings.Networks['stardust_internal'];
        
        if (!network || !network.IPAddress) {
            throw new Error(`Could not determine internal IP for container ${containerName}`);
        }

        const internalIp = network.IPAddress;
        console.log(`[SHARD_RUNNER] Container ${containerName} is UP at IP: ${internalIp}. Waiting for health check on port ${finalPort}...`);
        
        // 6. Polling TCP Health Check with Auto-Discovery (Timeout: 60s)
        const scanPorts = Array.from(new Set([finalPort, 3000, 4000, 5000, 5173, 8080, 5678, 8000]));
        let detectedPort = finalPort;

        const isHealthy = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(false);
            }, 60000);

            let sockets: net.Socket[] = [];

            const interval = setInterval(() => {
                for (const p of scanPorts) {
                    const socket = new net.Socket();
                    sockets.push(socket);
                    
                    socket.once('connect', () => {
                        clearTimeout(timeout);
                        clearInterval(interval);
                        
                        // Clean up all dangling sockets
                        for (const s of sockets) s.destroy();
                        
                        detectedPort = p;
                        resolve(true);
                    });
                    
                    socket.once('error', () => {
                        socket.destroy();
                    });
                    
                    socket.connect(p, internalIp);
                }
            }, 1000);
        });

        if (!isHealthy) {
            console.error(`[SHARD_RUNNER] Health check failed for ${containerName} after 60s. Fetching logs...`);
            try {
                const logs = await container.logs({ stdout: true, stderr: true, tail: 50 });
                console.error(`[SHARD_RUNNER] Crash Logs for ${containerName}:\n${logs.toString('utf8')}`);
            } catch (logErr) {
                console.error(`[SHARD_RUNNER] Could not fetch logs for crash on ${containerName}`);
            }
            try {
                await container.stop();
            } catch (e) {}
            throw new Error(`Health check timeout for ${containerName}`);
        }

        if (detectedPort !== finalPort) {
            console.log(`[SHARD_RUNNER] Auto-Discovery: Container ${containerName} is actually listening on ${detectedPort}! (Expected ${finalPort})`);
        } else {
            console.log(`[SHARD_RUNNER] Container ${containerName} passed health check and is READY on port ${detectedPort}.`);
        }
        
        return { ip: internalIp, port: detectedPort };
    }
}
