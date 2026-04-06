import Docker from 'dockerode';
import net from 'net';

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
        try {
            const parsedEnv = typeof envVarsParam === 'string' ? JSON.parse(envVarsParam) : envVarsParam;
            if (parsedEnv) {
                for (const [key, value] of Object.entries(parsedEnv)) {
                    envArray.push(`${key}=${value}`);
                    if (key.toUpperCase() === 'PORT') {
                        finalPort = parseInt(value as string, 10) || 3000;
                    }
                }
            }
        } catch (err) {
            console.warn(`[SHARD_RUNNER] Could not parse env vars as JSON for ${slug}, skipping injection.`);
        }
        
        if (!envArray.some(e => e.toUpperCase().startsWith('PORT='))) {
            envArray.push(`PORT=${finalPort}`);
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
            HostConfig: {
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
        
        // 6. Polling TCP Health Check (Timeout: 60s)
        const isHealthy = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(false);
            }, 60000);

            const interval = setInterval(() => {
                const socket = new net.Socket();
                socket.once('connect', () => {
                    clearTimeout(timeout);
                    clearInterval(interval);
                    socket.destroy();
                    resolve(true);
                });
                socket.once('error', () => {
                    socket.destroy();
                });
                socket.connect(finalPort, internalIp);
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

        console.log(`[SHARD_RUNNER] Container ${containerName} passed health check and is READY.`);
        
        return { ip: internalIp, port: finalPort };
    }
}
