import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

type CreateClientOptions = {
  mutateCookies?: boolean;
};

export async function createServerSupabaseClient(
  options: CreateClientOptions = {},
): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase environment variables are not set. Please define NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const cookieStore = await cookies();
  const allowMutations = options.mutateCookies === true;

  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        if (!allowMutations) {
          return;
        }
        try {
          cookieStore.set(name, value, options);
        } catch (error) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("Failed to set Supabase cookie", error);
          }
        }
      },
      remove(name: string, options: Record<string, unknown>) {
        if (!allowMutations) {
          return;
        }
        try {
          cookieStore.set(name, "", { ...options, maxAge: 0 });
        } catch (error) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("Failed to remove Supabase cookie", error);
          }
        }
      },
    },
  });
}
