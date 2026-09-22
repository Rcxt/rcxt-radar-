import './globals.css'

export const metadata = {
  title: 'RCXT Radar',
  description: 'Solana wallet intelligence and token signal terminal.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
