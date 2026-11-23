import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { Toaster } from '@/components/ui/sonner';

import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const mono = JetBrains_Mono({ variable: '--font-jetbrains-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Flows',
  description: 'Cron jobs and workflows for the agency and its clients',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-canvas text-ink">
          {children}
          <Toaster richColors />
      </body>
    </html>
  );
}
