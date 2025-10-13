import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

export default async function Home() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/signin");
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-6 pb-16 pt-10 dark:bg-neutral-950 sm:px-10">
      <Dashboard />
    </main>
  );
}
