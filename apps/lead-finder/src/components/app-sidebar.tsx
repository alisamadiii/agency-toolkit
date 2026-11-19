'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { History, LayoutDashboard, Moon, Settings, Store, Sun, Target } from 'lucide-react';
import { useTheme } from 'next-themes';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', icon: Store },
  { href: '/runs', label: 'Runs', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Target className="size-4" />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="font-heading text-sm font-semibold tracking-tight">
                    Lead Finder
                  </span>
                  <span className="text-xs text-muted-foreground">Ali Samadi Agency</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.label}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Toggle theme"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              <Sun className="dark:hidden" />
              <Moon className="hidden dark:block" />
              <span>Toggle theme</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
