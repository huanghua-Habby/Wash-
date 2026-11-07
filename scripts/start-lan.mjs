/** Explicit LAN mode: build a same-origin client and run the room registry / WebRTC signaling service for coworkers.
 * Gameplay runs in each room owner's browser; this process never simulates or relays inputs and snapshots. */
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as buildClient } from 'vite';
import { build as buildServer } from 'esbuild';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.LAN_PORT || process.env.PORT || process.env.APP_PORT || 8080);
const host=process.env.LAN_HOST || process.env.HOST || '0.0.0.0';
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid LAN_PORT');
const clientRoot=resolve(root,'dist/client');
if(!process.argv.includes('--no-build')) {
  await buildClient({configFile:resolve(root,'vite.config.js'),build:{outDir:clientRoot,emptyOutDir:true}});
  await buildServer({absWorkingDir:root,entryPoints:['server/src/main.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'dist/server/main.js'});
}
const {createServer}=await import(pathToFileURL(resolve(root,'dist/server/main.js')).href);
// Own STUN responder (UDP) so browsers learn their LAN address when mDNS candidates do not resolve; 0 disables it.
const stunPort=Number(process.env.WASH_STUN_PORT ?? 3478);
const {app}=await createServer({clientRoot,basePath:process.env.BASE_PATH || '/mp/wash-cn',stunPort});
await app.listen({host,port});
console.log(`\nWASH LAN: http://127.0.0.1:${port}/`);
if(host==='0.0.0.0')for(const [name,addresses] of Object.entries(networkInterfaces())) {
  for(const address of addresses || [])if(address.family==='IPv4'&&!address.internal)
    console.log(`  ${name}: http://${address.address}:${port}/`);
}
console.log(stunPort>0?`STUN (LAN address discovery only, no relay): udp ${stunPort}`:'STUN disabled');
console.log('Share the same LAN URL with all players. Room codes belong to this process; each room runs in its owner\'s browser.\n');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  app.log.info({signal},'Stopping room service');
  void app.close().then(()=>process.exit(0));
});
