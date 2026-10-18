"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { DashboardSquare01Icon } from "@hugeicons/core-free-icons";
import { Brand } from "@/components/brand";
import { brandName } from "@/lib/branding";
import { UserMenu } from "@/features/auth/components/user-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navigation = [
  { label: "Dashboard", href: "/dashboard", icon: DashboardSquare01Icon },
];

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const activeHref = pathname === "/dashboard" ? "/dashboard" : null;
  return (
    <Sidebar collapsible="icon" variant="inset" aria-label="Workspace sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={
                <Brand
                  render={<Link href="/" aria-label={`${brandName} home`} />}
                />
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Workspace">
              <SidebarMenu>
                {navigation.map(({ label, href, icon }) => (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      render={<Link href={href} />}
                      isActive={href === activeHref}
                      tooltip={label}
                      aria-label={label}
                      aria-current={href === activeHref ? "page" : undefined}
                      onClick={() => setOpenMobile(false)}
                    >
                      <HugeiconsIcon icon={icon} aria-hidden="true" />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu sidebar />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
