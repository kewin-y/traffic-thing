"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/features/auth/components/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Brand } from "@/components/brand";
import { brandName } from "@/lib/branding";

export function AppShell({ children }: { children: React.ReactNode }) {
  const isProject = usePathname().startsWith("/project/");
  return (
    <div
      data-slot="app-shell"
      className="min-h-svh bg-background font-[family-name:var(--font-geist-sans)] text-foreground"
    >
      <a
        href="#main-content"
        className="sr-only fixed top-2 left-2 z-60 rounded-md bg-background p-3 focus:not-sr-only"
      >
        Skip to content
      </a>
      {!isProject && (
        <header className="flex h-16 items-center justify-between gap-4 border-b px-5 sm:px-8">
          <div className="flex items-center gap-4">
            <Brand
              render={
                <Link href="/dashboard" aria-label={`${brandName} home`} />
              }
            />
            <span aria-hidden className="h-5 w-px bg-border" />
            <Link
              href="/dashboard"
              aria-current="page"
              className="rounded-md bg-muted px-3 py-2 text-xs font-medium"
            >
              Projects
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu compact />
          </div>
        </header>
      )}
      <main
        id="main-content"
        tabIndex={-1}
        className={
          isProject
            ? "h-svh min-h-0 outline-none"
            : "mx-auto flex max-w-[1440px] flex-col gap-8 px-5 py-10 outline-none sm:px-10 lg:px-[72px] lg:pt-14"
        }
      >
        {children}
      </main>
    </div>
  );
}
