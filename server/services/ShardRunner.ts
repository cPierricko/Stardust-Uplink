import Docker from 'dockerode';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export class ShardRunner {
    static async boot(slug: string, envVarsParam: any, port: number): Promise<string> {
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

        // 2. Prepare Environment Variables
        let envArray: string[] = [];
        try {
            const parsedEnv = typeof envVarsParam === 'string' ? JSON.parse(envVarsParam) : envVarsParam;
            if (parsedEnv) {
                for (const [key, value] of Object.entries(parsedEnv)) {
                    envArray.push(`${key}=${value}`);
                }
            }
        } catch (err) {
            console.warn(`[SHARD_RUNNER] Could not parse env vars as JSON for ${slug}, skipping injection.`);
        }
        
        // Ensure PORT is set to the internal target if it expects port via env
        envArray.push(`PORT=${port}`);

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
                // No PortBindings -> No public exposure
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
        console.log(`[SHARD_RUNNER] Container ${containerName} is UP at IP: ${internalIp}`);
        
        return internalIp;
    }
}
