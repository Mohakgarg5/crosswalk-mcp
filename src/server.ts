#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDb } from './store/db.ts';
import { seedRegistryIfEmpty } from './registryBoot.ts';
import { SamplingClient } from './sampling/client.ts';
// Adapters self-register on import
import './ats/greenhouse.ts';
import './ats/lever.ts';
import './ats/ashby.ts';

export const SERVER_NAME = 'crosswalk-mcp';
export const SERVER_VERSION = '0.0.1';

export function bootstrap() {
  const db = openDb();
  seedRegistryIfEmpty(db);
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );
  const sampling = new SamplingClient(server as unknown as ConstructorParameters<typeof SamplingClient>[0]);
  return { db, server, sampling };
}

export async function main() {
  const { server } = bootstrap();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
