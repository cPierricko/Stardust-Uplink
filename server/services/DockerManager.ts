import Docker from 'dockerode';
import os from 'os';

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
        } catch (error) {
            console.error('Failed to initialize DockerManager:', error);
            throw error;
        }
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
