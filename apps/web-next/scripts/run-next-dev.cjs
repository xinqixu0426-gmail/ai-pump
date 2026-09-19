const { spawn } = require('node:child_process');

const [port, distDir] = process.argv.slice(2);
if (!/^\d+$/.test(String(port || '')) || !distDir) {
    console.error('用法: node scripts/run-next-dev.cjs <port> <distDir>');
    process.exit(1);
}

const nextCli = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextCli, 'dev', '-p', port], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        NEXT_DIST_DIR: distDir,
    },
    stdio: 'inherit',
});

child.once('error', error => {
    console.error(`Next 开发服务启动失败: ${error.message}`);
    process.exitCode = 1;
});

child.once('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exitCode = code ?? 1;
});
