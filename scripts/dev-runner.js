import { spawn } from 'child_process'

console.log('🚀 Iniciando entorno de desarrollo local (API + Frontend)...')

const api = spawn('node', ['--experimental-strip-types', 'scripts/dev-server.ts'], {
  stdio: 'inherit',
  shell: true,
})

const frontend = spawn('npm', ['run', 'dev', '--prefix', 'frontend'], {
  stdio: 'inherit',
  shell: true,
})

const cleanup = () => {
  try {
    api.kill()
    frontend.kill()
  } catch {}
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
process.on('exit', cleanup)
