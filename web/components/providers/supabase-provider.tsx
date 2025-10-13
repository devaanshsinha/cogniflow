"use client";

import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { SessionContextProvider } from "@supabase/auth-helpers-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser-client";

type SupabaseProviderProps = {
  initialSession: Session | null;
  children: React.ReactNode;
};

export function SupabaseProvider({
  initialSession,
  children,
}: SupabaseProviderProps) {
  const [supabaseClient] = useState(() => createBrowserSupabaseClient());

  return (
    <SessionContextProvider
      supabaseClient={supabaseClient}
      initialSession={initialSession}
    >
      {children}
    </SessionContextProvider>
  );
}

