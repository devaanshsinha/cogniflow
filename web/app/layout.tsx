import type { Metadata } from "next";
import type { Session } from "@supabase/supabase-js";
import "./globals.css";
import { SupabaseProvider } from "@/components/providers/supabase-provider";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

export const metadata: Metadata = {
  title: "Cogniflow Dashboard",
  description: "Explore on-chain wallet activity with chat, charts, and analytics.",
  icons: {
    icon: "/logo.svg",
    shortcut: "/logo.svg",
    apple: "/logo.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createServerSupabaseClient();

  const authClient = supabase.auth as typeof supabase.auth & {
    suppressGetSessionWarning?: boolean;
  };
  authClient.suppressGetSessionWarning = true;

  const [
    {
      data: { user },
    },
    {
      data: { session },
    },
  ] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);

  const initialSession: Session | null = session
    ? {
        ...session,
        user: user ?? session.user ?? null,
      }
    : null;

  return (
    <html lang="en">
      <body className="antialiased">
        <SupabaseProvider initialSession={initialSession}>
          {children}
        </SupabaseProvider>
      </body>
    </html>
  );
}
