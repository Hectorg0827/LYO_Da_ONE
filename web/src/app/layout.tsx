import type { Metadata, Viewport } from 'next';
import { Inter, Nunito } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import AuthProvider from '@/components/providers/AuthProvider';
import InstallPWAPrompt from '@/components/providers/InstallPWAPrompt';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Web stand-in for iOS `.rounded` (SF Pro Rounded) display type. Apple
// browsers get the real thing via `ui-rounded`; everyone else gets Nunito.
const nunito = Nunito({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800', '900'],
  variable: '--font-nunito',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'LYO',
    template: '%s | LYO',
  },
  description: "The Living AI Classroom. Don't just chat with AI — learn with it.",
  keywords: ['AI learning', 'education', 'courses', 'personalized learning', 'LYO'],
  authors: [{ name: 'LYO Team' }],
  creator: 'LYO',
  // Installable PWA: manifest + icons so "Install Lyo" is a real browser
  // prompt, and it launches full-screen (display: standalone in the
  // manifest) instead of opening as a website inside Chrome.
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LYO',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    title: 'LYO',
    description: "The Living AI Classroom. Don't just chat with AI — learn with it.",
    siteName: 'LYO',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LYO',
    description: "The Living AI Classroom. Don't just chat with AI — learn with it.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: '#0d0f18',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${nunito.variable}`} suppressHydrationWarning>
      <body
        className="antialiased min-h-screen"
        style={{ color: 'var(--text-primary)' }}
      >
        <AuthProvider>
          <div className="dark">
            {children}
          </div>
        </AuthProvider>

        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: 'var(--surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              fontSize: '14px',
            },
            success: {
              iconTheme: {
                primary: '#22c55e',
                secondary: 'var(--surface)',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: 'var(--surface)',
              },
            },
          }}
        />

        <InstallPWAPrompt />
      </body>
    </html>
  );
}
