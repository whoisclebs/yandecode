import { z } from 'zod';

export const CONFIG_FILENAME = 'yandecode.json';

export const ConfigSchema = z.object({
  swarm: z
    .object({
      strategy: z.enum(['adaptive', 'star', 'pipeline']).default('adaptive'),
      maxAgents: z.number().int().min(1).max(8).default(4),
    })
    .default({ strategy: 'adaptive', maxAgents: 4 }),
  rag: z
    .object({
      enabled: z.boolean().default(true),
      embeddingModel: z.string().min(1).default('Snowflake/snowflake-arctic-embed-xs'),
      maxResults: z.number().int().min(1).max(12).default(8),
    })
    .default({
      enabled: true,
      embeddingModel: 'Snowflake/snowflake-arctic-embed-xs',
      maxResults: 8,
    }),
  memory: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
});

export type YandeCodeConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: YandeCodeConfig = ConfigSchema.parse({});
