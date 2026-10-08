// pm2 ile çalıştırma:  pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: "micros-bot",
      cwd: __dirname + "/..",
      script: "src/cli.ts",
      args: "daemon",
      interpreter: "node",
      interpreter_args: "--import tsx",
      autorestart: true,
      restart_delay: 30000,
      max_memory_restart: "800M",
      out_file: "logs/daemon.out.log",
      error_file: "logs/daemon.err.log",
      time: true,
    },
  ],
};
