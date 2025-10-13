"use client";

import { useState } from "react";
import Link from "next/link";
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

export default function SignUpPage(): JSX.Element {
  const supabase = useSupabaseClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!email || !password) {
      setError("Enter both email and password.");
      return;
    }

    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    setMessage(
      "Account created. Check your inbox for the confirmation email before signing in.",
    );
    setEmail("");
    setPassword("");
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-neutral-100 bg-gradient-to-br from-neutral-200 via-neutral-100 to-neutral-200 px-6 py-16 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900 sm:px-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 rounded-3xl border border-white/30 bg-white/70 px-8 py-12 shadow-2xl backdrop-blur dark:border-neutral-800/60 dark:bg-neutral-950/90 dark:shadow-neutral-950/40 sm:px-12 md:flex-row md:items-start">
        <div className="flex-1 space-y-4">
          <Badge variant="outline" className="border-neutral-400/50 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
            Cogniflow Access
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
            Create your Cogniflow account
          </h1>
          <p className="max-w-xl text-sm text-neutral-600 dark:text-neutral-400 sm:text-base">
            Register with email and password. If email confirmation is enabled, we’ll send you a verification link before you can sign in.
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-500">
            Having trouble receiving emails? Ensure SMTP is configured in Supabase or temporarily disable email confirmations in Auth settings.
          </p>
        </div>
        <Card className="w-full max-w-sm border-neutral-200/80 bg-white/95 shadow-xl dark:border-neutral-800 dark:bg-neutral-900/85">
          <CardHeader className="space-y-2 pb-4">
            <CardTitle className="text-lg font-semibold">Create account</CardTitle>
            <CardDescription className="text-sm">
              Minimum 6-character password recommended for Supabase Auth.
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
                  placeholder="Minimum 6 characters"
                  disabled={loading}
                  required
                  className="bg-white/90 dark:bg-neutral-900/70"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating…" : "Create account"}
              </Button>
            </form>
            {message ? (
              <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/40 dark:text-red-200">
                {error}
              </p>
            ) : null}
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              Already have an account?{" "}
              <Link
                href="/signin"
                className="font-semibold text-neutral-800 hover:underline dark:text-neutral-100"
              >
                Sign in here
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
