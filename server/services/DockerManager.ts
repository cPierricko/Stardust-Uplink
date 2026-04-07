import Docker from 'dockerode';
import os from 'os';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DockerManagerService {
    private docker: Docker;

    constructor() {
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    }

    async init() {
        try {
            // Verify if Docker is installed and running by pinging it
            await this.docker.ping();
            console.log('Docker is installed and running.');

            // Verify the existence of the stardust_internal network
            const networks = await this.docker.listNetworks();
            const networkExists = networks.some(net => net.Name === 'stardust_internal');

            if (!networkExists) {
                console.log('Network stardust_internal not found. Creating it...');
                await this.docker.createNetwork({
                    Name: 'stardust_internal',
                    Driver: 'bridge'
                });
                console.log('Network stardust_internal created.');
            } else {
                console.log('Network stardust_internal already exists.');
            }

            // Sync Container IPs with Database on boot
            try {
                const db = (await import('../db.js')).default;
                const shards = await this.listShards();
                for (const containerInfo of shards) {
                    const slug = containerInfo.Labels['com.stardust.shard'];
                    const netInfo = containerInfo.NetworkSettings?.Networks?.['stardust_internal'];
                    if (slug && netInfo && netInfo.IPAddress) {
                        db.prepare('UPDATE apps SET internal_ip = ?, status = ? WHERE slug = ?').run(netInfo.IPAddress, 'DEPLOYED', slug);
                    }
                }
                console.log('[+] Synchronized Shard IPs with Docker daemon.');
            } catch (syncErr: any) {
                console.warn('[!] Failed to sync Shard IPs on boot:', syncErr.message);
            }
        } catch (error) {
            console.error('[!] Failed to connect to Docker. Triggering self-heal...');
            try {
                await this.selfHeal();
                // Retry initialization after healing
                this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
                await this.docker.ping();
                console.log('[+] Docker reconnected successfully after self-heal.');
            } catch (healError) {
                console.error('[!] CRITICAL: Self-heal failed. Admin intervention required.', healError);
                throw healError;
            }
        }
    }

    async selfHeal() {
        console.log('[+] Starting Docker self-heal process...');
        return new Promise<void>((resolve, reject) => {
            const scriptPath = path.join(__dirname, '..', 'scripts', 'setup-vps.sh');
            const setupProcess = spawn('bash', [scriptPath]);

            setupProcess.stdout.on('data', (data) => {
                const message = data.toString().trim();
                if (message) console.log(`[SETUP-VPS] ${message}`);
            });

            setupProcess.stderr.on('data', (data) => {
                const message = data.toString().trim();
                if (message) console.error(`[SETUP-VPS ERR] ${message}`);
            });

            setupProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('[+] Docker self-heal process completed successfully.');
                    resolve();
                } else {
                    console.error(`[!] Docker self-heal process exited with code ${code}.`);
                    reject(new Error(`Provisioning script failed with code ${code}`));
                }
            });
        });
    }

    async getGlobalStats() {
        // Number of active containers
        const containers = await this.docker.listContainers({ all: false });
        const activeContainers = containers.length;

        // Global VPS stats (CPU/RAM)
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        const loadAvg = os.loadavg();
        
        return {
            memory: {
                total: totalMem,
                used: usedMem,
                free: freeMem,
                usagePercent: ((usedMem / totalMem) * 100).toFixed(2)
            },
            cpu: {
                loadAvg1: loadAvg[0],
                loadAvg5: loadAvg[1],
                loadAvg15: loadAvg[2],
                cores: os.cpus().length
            },
            activeContainers
        };
    }

    async listShards() {
        const containers = await this.docker.listContainers({
            all: true,
            filters: {
                label: ['com.stardust.shard']
            }
        });
        
        return containers;
    }
}

export const DockerManager = new DockerManagerService();
