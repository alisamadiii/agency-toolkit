import { AppSidebar } from '@/components/app-sidebar';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <TooltipProvider delayDuration={300}>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <span className="text-sm text-muted-foreground">Local dashboard</span>
          </header>
          <main className="w-full flex-1 px-4 py-8 md:px-8">{children}</main>
        </SidebarInset>
      </TooltipProvider>
    </SidebarProvider>
  );
}
