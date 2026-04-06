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
        if (fs.existsSync(path.join(shardPath, 'package.json'))) {
            console.log(`[SHARD_BUILDER] Detected Node.js project for ${slug}`);
            dockerfileContent = `
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# Start generic entrypoint if it exists
CMD ["sh", "-c", "if [ -f server.js ]; then node server.js; elif [ -f server.cjs ]; then node server.cjs; elif [ -f index.js ]; then node index.js; elif [ -f main.js ]; then node main.js; else npm start; fi"]
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
        
        console.log(`[SHARD_BUILDER] Dockerfile created, archiving and streaming to Docker daemon for ${slug}...`);

        return new Promise((resolve, reject) => {
            const pack = tar.pack(shardPath);
            
            docker.buildImage(pack, { t: tag }, (err, response) => {
                if (err) {
                    console.error(`[SHARD_BUILDER] Error starting build for ${slug}:`, err);
                    return reject(err);
                }
                
                if (!response) {
                    return reject(new Error('No response from docker build API'));
                }
                
                docker.modem.followProgress(response, 
                    (followErr, output) => { // onFinished
                        if (followErr) {
                            console.error(`[SHARD_BUILDER] Build failed for ${slug}:`, followErr);
                            return reject(followErr);
                        }
                        console.log(`[SHARD_BUILDER] Build successfully completed for ${slug} -> ${tag}`);
                        resolve();
                    }, 
                    (event: any) => { // onProgress
                        if (event.stream) {
                            const trimmed = event.stream.trim();
                            if (trimmed) {
                                console.log(`[BUILD ${slug}]`, trimmed);
                            }
                        } else if (event.error) {
                            console.error(`[BUILD ${slug} ERROR]`, event.error);
                        }
                    }
                );
            });
        });
    }
}
