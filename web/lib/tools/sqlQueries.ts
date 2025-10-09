import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const addressSchema = z
  .string()
  .regex(/^0x[a-f0-9]{40}$/i, "Address must be a 0x-prefixed hex string.")
  .transform((value) => value.toLowerCase());

const chainSchema = z.enum(["eth"]);

const isoDateSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO timestamp",
  })
  .transform((value) => new Date(value));

const TopCounterpartiesParams = z.object({
  address: addressSchema,
  chain: chainSchema.default("eth"),
  start: isoDateSchema,
  end: isoDateSchema,
  limit: z.number().int().min(1).max(25).default(5),
});

const NetFlowParams = z.object({
  address: addressSchema,
  chain: chainSchema.default("eth"),
  start: isoDateSchema,
  end: isoDateSchema,
});

type QueryDefinition<S extends z.ZodTypeAny> = {
  schema: S;
  execute: (params: z.infer<S>) => Promise<unknown>;
};

const namedQueries = {
  topCounterparties: {
    schema: TopCounterpartiesParams,
    execute: async (params: z.infer<typeof TopCounterpartiesParams>) => {
      const rows = await prisma.$queryRaw<
        Array<{
          counterparty: string;
          total_volume: Prisma.Decimal;
          incoming_volume: Prisma.Decimal;
          outgoing_volume: Prisma.Decimal;
          transfer_count: bigint;
        }>
      >`
        WITH movements AS (
          SELECT
            CASE
              WHEN "from_addr" = ${params.address} THEN "to_addr"
              ELSE "from_addr"
            END AS counterparty,
            CASE
              WHEN "from_addr" = ${params.address} THEN -"amount_dec"
              ELSE "amount_dec"
            END AS signed_amount,
            CASE WHEN "from_addr" = ${params.address} THEN 0 ELSE "amount_dec" END AS incoming,
            CASE WHEN "from_addr" = ${params.address} THEN "amount_dec" ELSE 0 END AS outgoing
          FROM "transfers"
          WHERE "chain" = ${params.chain}
            AND "timestamp" BETWEEN ${params.start} AND ${params.end}
            AND ("from_addr" = ${params.address} OR "to_addr" = ${params.address})
        )
        SELECT
          counterparty,
          SUM(signed_amount) AS total_volume,
          SUM(incoming)     AS incoming_volume,
          SUM(outgoing)     AS outgoing_volume,
          COUNT(*)::bigint  AS transfer_count
        FROM movements
        GROUP BY counterparty
        ORDER BY SUM(incoming) DESC
        LIMIT ${params.limit}
      `;

      return rows.map((row) => ({
        counterparty: row.counterparty,
        totalVolume: row.total_volume.toString(),
        incomingVolume: row.incoming_volume.toString(),
        outgoingVolume: row.outgoing_volume.toString(),
        transferCount: Number(row.transfer_count),
      }));
    },
  } satisfies QueryDefinition<typeof TopCounterpartiesParams>,
  netFlowSummary: {
    schema: NetFlowParams,
    execute: async (params: z.infer<typeof NetFlowParams>) => {
      const result = await prisma.$queryRaw<
        Array<{
          incoming_volume: Prisma.Decimal;
          outgoing_volume: Prisma.Decimal;
          net_volume: Prisma.Decimal;
          incoming_count: bigint;
          outgoing_count: bigint;
        }>
      >`
        WITH scoped AS (
          SELECT
            CASE WHEN "from_addr" = ${params.address} THEN 0 ELSE "amount_dec" END AS incoming,
            CASE WHEN "from_addr" = ${params.address} THEN "amount_dec" ELSE 0 END AS outgoing,
            CASE
              WHEN "from_addr" = ${params.address} THEN -"amount_dec"
              ELSE "amount_dec"
            END AS net_change,
            CASE WHEN "from_addr" = ${params.address} THEN 0 ELSE 1 END AS incoming_flag,
            CASE WHEN "from_addr" = ${params.address} THEN 1 ELSE 0 END AS outgoing_flag
          FROM "transfers"
          WHERE "chain" = ${params.chain}
            AND "timestamp" BETWEEN ${params.start} AND ${params.end}
            AND ("from_addr" = ${params.address} OR "to_addr" = ${params.address})
        )
        SELECT
          COALESCE(SUM(incoming), 0)        AS incoming_volume,
          COALESCE(SUM(outgoing), 0)        AS outgoing_volume,
          COALESCE(SUM(net_change), 0)      AS net_volume,
          COALESCE(SUM(incoming_flag), 0)::bigint AS incoming_count,
          COALESCE(SUM(outgoing_flag), 0)::bigint AS outgoing_count
        FROM scoped
      `;

      const row = result.at(0);
      return {
        incomingVolume: row?.incoming_volume?.toString() ?? "0",
        outgoingVolume: row?.outgoing_volume?.toString() ?? "0",
        netVolume: row?.net_volume?.toString() ?? "0",
        incomingCount: Number(row?.incoming_count ?? 0),
        outgoingCount: Number(row?.outgoing_count ?? 0),
      };
    },
  } satisfies QueryDefinition<typeof NetFlowParams>,
} satisfies Record<string, QueryDefinition<z.ZodTypeAny>>;

export type NamedQueryName = keyof typeof namedQueries;

const requestSchema = z.object({
  name: z.enum(
    Object.keys(namedQueries) as [
      NamedQueryName,
      ...Array<NamedQueryName>
    ],
  ),
  params: z.record(z.unknown()),
});

export type NamedQueryRequest = z.infer<typeof requestSchema>;

export async function executeNamedQuery(
  input: NamedQueryRequest,
): Promise<unknown> {
  const parsed = requestSchema.parse(input);
  const definition = namedQueries[parsed.name];
  if (!definition) {
    throw new Error(`Unsupported query name: ${parsed.name}`);
  }

  const parsedParams = definition.schema.parse(parsed.params);
  return definition.execute(parsedParams as never);
}

export function listNamedQueries(): string[] {
  return Object.keys(namedQueries);
}
