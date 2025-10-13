import { PrismaClient } from "@prisma/client";

type GlobalWithPrisma = typeof globalThis & {
  __prisma?: PrismaClient;
};

const globalForPrisma = globalThis as GlobalWithPrisma;

const prismaClient =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prismaClient;
}

export const prisma = prismaClient;

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  if (process.env.NODE_ENV !== "production") {
    delete globalForPrisma.__prisma;
  }
}

export default prisma;
