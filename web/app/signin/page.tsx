"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSupabaseClient } from "@supabase/auth-helpers-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function SignInPage(): JSX.Element {
  const supabase = useSupabaseClient();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Enter both email and password.");
      return;
    }

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    router.replace("/");
    router.refresh();
  };

  const onGoogle = async () => {
    setError(null);
    setLoading(true);
    const origin =
      typeof window !== "undefined" ? window.location.origin : undefined;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: origin },
    });
    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100 bg-gradient-to-br from-neutral-200 via-neutral-100 to-neutral-200 px-6 py-16 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900 sm:px-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 rounded-3xl border border-white/30 bg-white/70 px-8 py-12 shadow-2xl backdrop-blur dark:border-neutral-800/60 dark:bg-neutral-950/90 dark:shadow-neutral-950/40 sm:px-12 md:flex-row md:items-start">
        <div className="flex-1 space-y-4">
          <Badge variant="outline" className="border-neutral-400/50 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
            Cogniflow Access
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
            Sign in to Cogniflow
          </h1>
          <p className="max-w-xl text-sm text-neutral-600 dark:text-neutral-400 sm:text-base">
            Enter your credentials or continue with Google to access wallet analytics, chat insights, and semantic search.
          </p>
        </div>
        <Card className="w-full max-w-sm border-neutral-200/80 bg-white/95 shadow-xl dark:border-neutral-800 dark:bg-neutral-900/85">
          <CardHeader className="space-y-2 pb-4">
            <CardTitle className="text-lg font-semibold">Sign in</CardTitle>
            <CardDescription className="text-sm">
              Secure password authentication.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-3" onSubmit={onSubmit}>
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
                  Email
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  disabled={loading}
                  required
                  className="bg-white/90 dark:bg-neutral-900/70"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
                  Password
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  required
                  className="bg-white/90 dark:bg-neutral-900/70"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
            <Button
              type="button"
              variant="outline"
              className="w-full border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
              onClick={onGoogle}
              disabled={loading}
            >
              Continue with Google
            </Button>
            {error ? (
              <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/40 dark:text-red-200">
                {error}
              </p>
            ) : null}
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              Don’t have an account?{" "}
              <Link
                href="/signup"
                className="font-semibold text-neutral-800 hover:underline dark:text-neutral-100"
              >
                Create one now
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
