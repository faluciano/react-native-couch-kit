import { Command } from 'commander';
import WebSocket from 'ws';
import { MessageTypes } from '@party-kit/core';

export const simulateCommand = new Command('simulate')
  .description('Spawns headless bots to simulate players')
  .option('-n, --count <number>', 'Number of bots', '4')
  .option('-u, --url <url>', 'WebSocket URL of host', 'ws://localhost:8082')
  .option('-i, --interval <ms>', 'Action interval in ms', '1000')
  .action(async (options) => {
    const count = parseInt(options.count);
    const url = options.url;
    const interval = parseInt(options.interval);
    
    console.log(`🤖 Spawning ${count} bots connecting to ${url}...`);
    
    const bots: WebSocket[] = [];

    for (let i = 0; i < count; i++) {
        const ws = new WebSocket(url);
        
        ws.on('open', () => {
            console.log(`[Bot ${i}] Connected`);
            
            // Join
            ws.send(JSON.stringify({
                type: MessageTypes.JOIN,
                payload: { name: `Bot ${i}`, avatar: '🤖' }
            }));

            // Random Actions Loop
            setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: MessageTypes.ACTION,
                        payload: { type: 'RANDOM_ACTION', payload: Math.random() }
                    }));
                }
            }, interval + (Math.random() * 500)); // Add jitter
        });

        ws.on('close', () => {
            console.log(`[Bot ${i}] Disconnected`);
        });

        ws.on('error', (e) => {
            console.error(`[Bot ${i}] Error:`, e.message);
        });

        bots.push(ws);
        // Stagger connections slightly
        await new Promise(r => setTimeout(r, 100));
    }

    // Keep process alive
    process.stdin.resume();
    
    process.on('SIGINT', () => {
        console.log('\nStopping bots...');
        bots.forEach(b => b.close());
        process.exit();
    });
  });
