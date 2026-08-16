import { PrismaClient } from "@prisma/client";

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

const withPrismaPoolSettings = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.searchParams.has("connection_limit")) {
      parsed.searchParams.set("connection_limit", "20");
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", "20");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
};

const datasourceUrl = process.env.DATABASE_URL ? withPrismaPoolSettings(process.env.DATABASE_URL) : undefined;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ["error", "warn"],
    ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {})
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
