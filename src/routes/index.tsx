import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main>
      <h1>BhayanakCast</h1>
      <p>Community screen-sharing rooms.</p>
    </main>
  )
}
